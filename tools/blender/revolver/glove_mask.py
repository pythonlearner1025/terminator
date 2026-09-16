"""Continuous fingerless-glove boundary in the measured rest projection."""
blend=material('Left curved glove and skin',(.1,.06,.04),.54,0,120)
n=blend.node_tree.nodes;l=blend.node_tree.links;bs=n.get('Principled BSDF');coord=n.new('ShaderNodeTexCoord')
def mathnode(operation,*values):
 node=n.new('ShaderNodeMath');node.operation=operation
 for index,value in enumerate(values):
  if isinstance(value,(int,float)):node.inputs[index].default_value=value
  else:l.new(value,node.inputs[index])
 return node.outputs[0]
rotation=Quaternion((1,0,0),.12)@Quaternion((0,1,0),pi+.10);matrix=rotation.to_matrix()
world=[]
for row,offset in zip(matrix,[.248,-.179,-.56]):
 dot=n.new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT';dot.inputs[1].default_value=(row[0],-row[2],row[1]);l.new(coord.outputs['Object'],dot.inputs[0]);world.append(mathnode('ADD',dot.outputs['Value'],offset))
depth=mathnode('MULTIPLY',world[2],-1);k=270/math.tan(math.radians(26))
x=mathnode('ADD',480,mathnode('MULTIPLY',k,mathnode('DIVIDE',world[0],depth)))
y=mathnode('SUBTRACT',270,mathnode('MULTIPLY',k,mathnode('DIVIDE',world[1],depth)))
ybase=mathnode('SUBTRACT',y,432)
boundary=mathnode('ADD',mathnode('ADD',591,mathnode('MULTIPLY',ybase,.87)),mathnode('MULTIPLY',5,mathnode('SINE',mathnode('MULTIPLY',ybase,.075))))
distance=mathnode('SUBTRACT',x,boundary)
soft=n.new('ShaderNodeMapRange');soft.interpolation_type='SMOOTHSTEP';soft.inputs['From Min'].default_value=-.5;soft.inputs['From Max'].default_value=.5;l.new(distance,soft.inputs['Value'])
def colors(low,high,scale):
 tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=scale;tex.inputs['Detail'].default_value=5;l.new(coord.outputs['Generated'],tex.inputs['Vector'])
 ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*low,1);ramp.color_ramp.elements[1].color=(*high,1);l.new(tex.outputs['Fac'],ramp.inputs[0]);return ramp.outputs[0]
glove_color=colors((.001,.0008,.0006),(.022,.018,.015),13)
skin_color=colors((.28,.17,.12),(.40,.27,.21),80)
base=n.new('ShaderNodeMixRGB');l.new(soft.outputs[0],base.inputs[0]);l.new(glove_color,base.inputs[1]);l.new(skin_color,base.inputs[2]);l.new(base.outputs[0],bs.inputs['Base Color'])
rough=n.new('ShaderNodeMapRange');rough.inputs['From Min'].default_value=0;rough.inputs['From Max'].default_value=1;rough.inputs['To Min'].default_value=.8;rough.inputs['To Max'].default_value=.54;l.new(soft.outputs[0],rough.inputs['Value']);l.new(rough.outputs[0],bs.inputs['Roughness'])
material_sources[blend.name]=(base.outputs[0],rough.outputs[0],0)
