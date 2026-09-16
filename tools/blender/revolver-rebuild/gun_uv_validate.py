"""Inspect actual exported float32 GLB UV triangles, matching assembly's 1e-12 determinant gate."""
import json,struct,math,argparse,hashlib
from pathlib import Path

def inspect(path):
 raw=Path(path).read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);offset=20+length;binary=raw[offset+8:offset+8+struct.unpack_from('<I',raw,offset)[0]]
 def accessor(index):
  a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];fmt,size={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}[a['componentType']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',n*size)
  return [struct.unpack_from('<'+fmt*n,binary,start+i*stride) for i in range(a['count'])]
 result={'artifact':str(Path(path).resolve()),'uvDeterminantTolerance':1e-12,'toleranceMeaning':'twice normalized UV area; 0.000001048576 pixel squared at 1024 (twice area)','triangles':0,'collapsed':[],'zeroGeometryTriangles':[],'minimumTwiceGeometryArea':1,'minimumAbsoluteUvDeterminant':1,'meshes':{}}
 for mesh in doc['meshes']:
  count=0;bad=[];minimum=1;bindings=[]
  for pi,p in enumerate(mesh['primitives']):
   positions=accessor(p['attributes']['POSITION']);uvs=accessor(p['attributes']['TEXCOORD_0']);indices=[v[0] for v in accessor(p['indices'])] if 'indices' in p else list(range(len(positions)))
   for t in range(0,len(indices),3):
    ids=indices[t:t+3];bindings.append(sorted([positions[i]+uvs[i] for i in ids]));a,b,c=[uvs[i] for i in ids];det=abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]));minimum=min(minimum,det);count+=1
    xyz=[positions[i] for i in ids];v=[xyz[1][k]-xyz[0][k] for k in range(3)];w=[xyz[2][k]-xyz[0][k] for k in range(3)];cross=[v[1]*w[2]-v[2]*w[1],v[2]*w[0]-v[0]*w[2],v[0]*w[1]-v[1]*w[0]];geometry_area=math.sqrt(sum(x*x for x in cross))
    result['minimumTwiceGeometryArea']=min(result['minimumTwiceGeometryArea'],geometry_area)
    if geometry_area<=1e-18:result['zeroGeometryTriangles'].append({'mesh':mesh['name'],'primitive':pi,'triangle':t//3,'twiceGeometryArea':geometry_area})
    if det<1e-12:
     bad.append({'mesh':mesh['name'],'primitive':pi,'triangle':t//3,'indices':ids,'uv': [a,b,c],'positions':xyz,'uvDeterminant':det,'twiceGeometryArea':math.sqrt(sum(x*x for x in cross))})
  result['meshes'][mesh['name']]={'triangles':count,'collapsed':len(bad),'minimumAbsoluteUvDeterminant':minimum,'geometryUvSignature':hashlib.sha256(json.dumps(sorted(bindings),separators=(',',':')).encode()).hexdigest()};result['triangles']+=count;result['collapsed'].extend(bad);result['minimumAbsoluteUvDeterminant']=min(result['minimumAbsoluteUvDeterminant'],minimum)
 result['pass']=len(result['collapsed'])==0 and not result['zeroGeometryTriangles'];return result
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('glb',nargs='?',default=str(Path(__file__).resolve().parent/'generated/gun/gun.glb'));parser.add_argument('--output');args=parser.parse_args();r=inspect(args.glb)
 if args.output:Path(args.output).write_text(json.dumps(r,indent=2)+'\n')
 print(json.dumps(r,indent=2));raise SystemExit(0 if r['pass'] else 1)
