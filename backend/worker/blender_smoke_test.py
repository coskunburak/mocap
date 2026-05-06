#!/usr/bin/env python3
import json
import math
import sys


def write(path, payload):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))


def main():
    if "--" not in sys.argv:
        raise SystemExit("Expected -- bvh_path output_path")
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 2:
        raise SystemExit("Expected bvh_path output_path")
    bvh_path, output_path = args

    import bpy

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_anim.bvh(filepath=bvh_path)

    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    errors = []
    warnings = []
    if not armatures:
        errors.append("No armature imported from BVH.")

    frame_start = int(bpy.context.scene.frame_start)
    frame_end = int(bpy.context.scene.frame_end)
    if frame_end <= frame_start:
        errors.append("Imported BVH has no animated frame range.")

    for obj in bpy.context.scene.objects:
        matrix_values = [value for row in obj.matrix_world for value in row]
        if any(not math.isfinite(float(value)) for value in matrix_values):
            errors.append(f"Object has non-finite world transform: {obj.name}")
            break

    metrics = {
        "armatureCount": len(armatures),
        "objectCount": len(bpy.context.scene.objects),
        "frameStart": frame_start,
        "frameEnd": frame_end,
    }
    write(
      output_path,
        {
            "ok": len(errors) == 0,
            "skipped": False,
            "warnings": warnings,
            "errors": errors,
            "metrics": metrics,
        },
    )


if __name__ == "__main__":
    main()
