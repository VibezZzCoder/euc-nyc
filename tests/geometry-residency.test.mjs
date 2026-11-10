// CPU exercise of the real pinned Three attribute/geometry owners and native upload implementations.
// Adapted from EUC SF aa44c1c tests/helpers/geometry-upload-fixture.mjs (VibezZzCoder, MIT).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import { installGeometryResidency } from '../js/geometry-residency.js';
const source = readFileSync(new URL('../vendor/three/build/three.webgpu.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
};
const { DataMap, Attributes, Geometries, Info } = new Function('DynamicDrawUsage', 'Uint16BufferAttribute', 'Uint32BufferAttribute',
  section('class DataMap {', '/**\n * Abstract class for representing pipelines.') + '\nreturn {DataMap,Attributes,Geometries,Info};')(
  THREE.DynamicDrawUsage, THREE.Uint16BufferAttribute, THREE.Uint32BufferAttribute);
const GLUtils = new Function('IntType', 'DualAttributeData', 'let _id$1=0;\n' +
  section('class WebGLAttributeUtils {', '/**\n * A WebGL 2 backend utility module for managing vertex array objects') + '\nreturn WebGLAttributeUtils;')(THREE.IntType, class {});
const GPUUtils = new Function('GPUBufferUsage', 'GPUInputStepMode', '_bufferDescriptor$3', 'Float16BufferAttribute', 'error', 'isTypedArray',
  section('const typedArraysToVertexFormatPrefix =', 'const _bindGroupDescriptor =') + '\nreturn WebGPUAttributeUtils;')(
  { MAP_READ:1,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,STORAGE:128,INDIRECT:256 }, { Instance:'instance',Vertex:'vertex' },
  { reset() { delete this.label; delete this.size; delete this.usage; delete this.mappedAtCreation; } },
  THREE.Float16BufferAttribute, message => { throw Error(message); }, ArrayBuffer.isView);
const raw = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
function fixture(gl) {
  const backend = new DataMap(), calls = []; let bound;
  backend.set = (k,v) => backend.data.set(k,v);
  backend.getBufferAttribute = a => a.isInterleavedBufferAttribute ? a.data : a;
  backend.deleteVertexState = () => {};
  const create = n => { assert.ok(n > 0); calls.push(n); return { bytes:Buffer.alloc(n),size:n,destroy(){} }; };
  if (gl) {
    backend.isWebGLBackend = true; backend.state = { currentVAO:null };
    backend.gl = { ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,COPY_WRITE_BUFFER:36663,STATIC_DRAW:35044,
      FLOAT:5126,HALF_FLOAT:5131,UNSIGNED_SHORT:5123,UNSIGNED_INT:5125,INT:5124,
      createBuffer:()=>({}),bindBuffer(t,b){bound=b;},bufferData(t,a){Object.assign(bound,create(a.byteLength));raw(a).copy(bound.bytes);},
      bufferSubData(t,o,a){assert.ok(a.byteLength);raw(a).copy(bound.bytes,o);},deleteBuffer(){} };
    backend.utils = new GLUtils(backend);
    backend.createAttribute = a => backend.utils.createAttribute(a,34962);
    backend.createIndexAttribute = a => backend.utils.createAttribute(a,34963);
  } else {
    backend.isWebGPUBackend = true;
    backend.device = { createBuffer(d) { const b=create(d.size),array=new ArrayBuffer(d.size);
      b.getMappedRange=()=>array;b.unmap=()=>Buffer.from(array).copy(b.bytes);return b; },
      queue:{writeBuffer(b,o,a){assert.ok(a.byteLength);raw(a).copy(b.bytes,o);}} };
    backend.utils = new GPUUtils(backend);
    backend.createAttribute = a => backend.utils.createAttribute(a,44);
    backend.createIndexAttribute = a => backend.utils.createAttribute(a,28);
  }
  backend.updateAttribute = a => backend.utils.updateAttribute(a);
  backend.destroyAttribute = a => backend.utils.destroyAttribute(a);
  const info=new Info(),_attributes=new Attributes(backend,info),_geometries=new Geometries(backend,_attributes,info);
  const renderer={backend,info,_attributes,_geometries};
  return { renderer,calls,submit(mesh,bindings=[]) { info.render.calls++;
    _geometries.updateForRender({object:mesh,geometry:mesh.geometry,material:mesh.material,
      getAttributes:()=>Object.values(mesh.geometry.attributes),getBindings:()=>bindings}); },
    buffer(a){const d=backend.get(a);return gl?d.bufferGPU:d.buffer;},stop(){_geometries.dispose();_attributes.dispose();} };
}
for (const gl of [false,true]) test(`${gl?'WebGL2':'WebGPU'} actual upload bytes/accounting, unsafe aliases and terminal ownership`, () => {
  const f=fixture(gl),scene=new THREE.Scene(),root=new THREE.Group();scene.add(root);
  const mesh=()=>new THREE.Mesh(new THREE.BoxGeometry(2,3,4),new THREE.MeshBasicMaterial());
  const a=mesh(),b=mesh(),dynamic=mesh(),unseen=mesh(),storage=mesh();root.add(a,b,dynamic,unseen,storage);
  dynamic.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  scene.add(new THREE.InstancedMesh(b.geometry,undefined,2));
  const expected=new Map([...Object.values(a.geometry.attributes),a.geometry.index].map(attr=>[attr,Buffer.from(raw(attr.array))]));
  const before=f.renderer._geometries.updateForRender;
  const installed=installGeometryResidency(f.renderer,scene,[root]);assert.equal(f.calls.length,0);
  f.submit(a);f.submit(b);f.submit(dynamic);
  const p=storage.geometry.attributes.position;
  f.submit(storage,[{bindings:[{isStorageBuffer:true,attribute:p}]}]);
  for(const [attr,bytes] of expected) {
    assert.equal(attr.array.length,0);assert.ok(f.buffer(attr).bytes.subarray(0,bytes.length).equals(bytes));
    assert.equal(f.renderer.info.memoryMap.get(attr).size,bytes.length);assert.ok(attr.count>0);
  }
  assert.ok(b.geometry.attributes.position.array.length>0);assert.ok(dynamic.geometry.attributes.position.array.length>0);
  assert.ok(unseen.geometry.attributes.position.array.length>0);assert.ok(p.array.length>0);
  const calls=f.calls.length;f.submit(a);assert.equal(f.calls.length,calls);
  a.geometry.attributes.position.needsUpdate=true;assert.throws(()=>f.submit(a),/mutated/);
  a.geometry.attributes.position.version--;a.geometry.dispose();assert.throws(()=>f.submit(a),/disappeared/);
  installed.dispose();installed.dispose();assert.equal(f.renderer._geometries.updateForRender,before);f.stop();
});
