"""Call the official Blender MCP through stdio, using the MCP Python SDK.

Run with the Python environment containing the official blender-mcp package.
Accept a saved Blender Python script or a tool name with a JSON arguments file.
"""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--code-file', type=Path)
    p.add_argument('--tool', default='execute_blender_code')
    p.add_argument('--arguments-file', type=Path)
    p.add_argument('--image-output', type=Path)
    args = p.parse_args()
    if args.code_file and args.arguments_file:
        p.error('Use either --code-file or --arguments-file')
    params = json.loads(args.arguments_file.read_text()) if args.arguments_file else {}
    if args.code_file:
        params = {'code': args.code_file.read_text()}
    server = StdioServerParameters(command=sys.executable, args=['-m', 'blmcp'],
                                  env={**os.environ, 'BLENDER_MCP_HOST': '127.0.0.1'})
    async with stdio_client(server) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            response = await session.call_tool(args.tool, params)
            failed = bool(response.isError)
            for block in response.content:
                if block.type == 'text':
                    print(block.text)
                    try:
                        failed |= json.loads(block.text).get('status') == 'error'
                    except (ValueError, AttributeError):
                        pass
                elif block.type == 'image':
                    if not args.image_output:
                        p.error('Image tool requires --image-output')
                    args.image_output.parent.mkdir(parents=True, exist_ok=True)
                    args.image_output.write_bytes(base64.b64decode(block.data))
                    print(json.dumps({'image': str(args.image_output), 'mimeType': block.mimeType}))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
