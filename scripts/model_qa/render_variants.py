"""
Render a raw prop GLB and its optimized variants from identical cameras, so the
variants can be compared against the raw mesh pixel for pixel.

Run with Blender 4.5 headless:
    blender.exe --background --python render_variants.py -- <out_dir> <label=path> [<label=path> ...]

The FIRST label=path pair is the reference (the raw generator output). Every
variant is framed with the reference's bounding box, so a variant that shrank or
lost a limb shows up as a silhouette change instead of being re-framed away.

Per variant, writes into <out_dir>/<label>/:
  tex_game.png   textured, orthographic, the game's 37 deg camera pitch
  grey_*.png     untextured grey from 4 sides + the game angle, transparent
                 background (the alpha is the silhouette mask)
"""
import bpy, sys, os, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
out_dir = argv[0]
variants = [a.split("=", 1) for a in argv[1:]]

GAME_PITCH = 0.64          # CAM_DEFAULT_PITCH in src/game/camera_director.js
GAME_AZIMUTH = math.radians(-45)
RES = 640


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def bbox(objs):
    pts = [o.matrix_world @ mathutils.Vector(c) for o in objs for c in o.bound_box]
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def snap_scale(objs, ref_size):
    """Blender reads Draco .opt.glb files at ~1000x the raw scale. Undo that by
    the nearest power of ten only, so a real size change is not normalized away."""
    lo, hi = bbox(objs)
    size = max(hi - lo)
    if size <= 0:
        return
    factor = 10 ** round(math.log10(ref_size / size))
    if factor == 1:
        return
    for o in bpy.context.scene.objects:
        if o.parent is None:
            o.location *= factor
            o.scale *= factor
    bpy.context.view_layer.update()


def game_materials(objs):
    """Mirror registerProp() in src/render/dungeon_scene.js: matte, non-metal,
    weak specular, no emission."""
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            for n in m.node_tree.nodes:
                if n.type != 'BSDF_PRINCIPLED':
                    continue
                if not n.inputs["Roughness"].is_linked and n.inputs["Roughness"].default_value < 0.8:
                    n.inputs["Roughness"].default_value = 0.88
                if not n.inputs["Metallic"].is_linked:
                    n.inputs["Metallic"].default_value = 0.0
                if "Specular IOR Level" in n.inputs:
                    n.inputs["Specular IOR Level"].default_value = 0.15
                if "Emission Strength" in n.inputs:
                    n.inputs["Emission Strength"].default_value = 0.0


def grey_material(objs):
    mat = bpy.data.materials.new("qa_grey")
    mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (0.62, 0.62, 0.64, 1)
    b.inputs["Roughness"].default_value = 0.55
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = 16
    scene.render.resolution_x = RES
    scene.render.resolution_y = RES
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    key = bpy.data.objects.new("key", bpy.data.lights.new("key", 'SUN'))
    key.data.energy = 3.0
    key.rotation_euler = (math.radians(40), 0, math.radians(-30))
    bpy.context.collection.objects.link(key)
    rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", 'SUN'))
    rim.data.energy = 1.2
    rim.rotation_euler = (math.radians(60), 0, math.radians(150))
    bpy.context.collection.objects.link(rim)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    return scene, cam


def place(cam, center, radius, azimuth, elevation, ortho):
    d = radius * 4.0
    cam.location = center + mathutils.Vector((
        d * math.cos(elevation) * math.cos(azimuth),
        d * math.cos(elevation) * math.sin(azimuth),
        d * math.sin(elevation)))
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = radius * 2.3
    else:
        cam.data.type = 'PERSP'
        cam.data.lens = 50
        cam.data.clip_end = d * 4


def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


GREY_VIEWS = [
    ("grey_game", GAME_AZIMUTH, GAME_PITCH, True),
    ("grey_front", GAME_AZIMUTH, math.radians(12), False),
    ("grey_side", GAME_AZIMUTH + math.pi / 2, math.radians(12), False),
    ("grey_back", GAME_AZIMUTH + math.pi, math.radians(12), False),
    ("grey_top", GAME_AZIMUTH, math.radians(80), True),
]

ref_center = ref_radius = ref_size = None
for label, path in variants:
    vdir = os.path.join(out_dir, label)
    os.makedirs(vdir, exist_ok=True)

    reset()
    objs = import_glb(path)
    if not objs:
        raise SystemExit(f"no meshes in {path}")
    if ref_size is None:
        lo, hi = bbox(objs)
        ref_center = (lo + hi) / 2
        ref_size = max(hi - lo)
        ref_radius = ref_size / 2
    else:
        snap_scale(objs, ref_size)

    scene, cam = setup_scene()
    game_materials(objs)
    place(cam, ref_center, ref_radius, GAME_AZIMUTH, GAME_PITCH, True)
    render(scene, os.path.join(vdir, "tex_game.png"))

    grey_material(objs)
    for name, az, el, ortho in GREY_VIEWS:
        place(cam, ref_center, ref_radius, az, el, ortho)
        render(scene, os.path.join(vdir, f"{name}.png"))
    print(f"QA_RENDERED {label}", flush=True)

print("QA_RENDER_DONE", flush=True)
