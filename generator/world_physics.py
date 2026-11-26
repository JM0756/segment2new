"""Normalized map coordinates use the center of each structure or solid's footprint."""
from copy import deepcopy
import json
from pathlib import Path
import re


MATERIALS = json.loads((Path(__file__).resolve().parents[1]/"arcade/world_materials.json").read_text())


def merge(base, changes):
    if not isinstance(base, dict) or not isinstance(changes, dict):
        return deepcopy(changes)
    result = deepcopy(base)
    for key, value in changes.items():
        result[key] = merge(result.get(key), value)
    return result


def edits_since(original, revised):
    """Extract only changed fields so another tier keeps its own map geometry."""
    if not isinstance(original, dict) or not isinstance(revised, dict):
        return deepcopy(revised)
    return {key: edits_since(original.get(key), value) for key, value in revised.items()
            if value != original.get(key)}


def patch_world(base, changes):
    result = merge(base, changes)
    if not isinstance(result, dict) or not isinstance(result.get("surface"), dict):
        return result
    surface = result["surface"]
    if surface["type"] != base["surface"]["type"]:
        material = surface["type"]
        if isinstance(material,str) and material in MATERIALS:
            for key in ("speedMultiplier", "drag", "trailStyle"):
                if key not in changes["surface"]:
                    surface[key] = MATERIALS[material][key]
    return result


def default_world(config, level=1, description=""):
    theme = config["theme"]
    env = theme.get("environment") if isinstance(theme.get("environment"), dict) else {}
    settings = (description, env.get("setting_name"), env.get("layout"), theme.get("setting"))
    surface = next((name for setting in settings for name, preset in MATERIALS.items()
                    if re.search(preset["pattern"], str(setting), re.I)), "stone")
    preset = MATERIALS[surface]
    style, kind = preset["portal"], preset["kind"]
    archetype = config["archetype"]
    scanner, reaction = {"audit": ("evidence desk", "stamp_press"), "threshold": ("sensor beacon", "scan_ring"),
                         "sorter": ("conduit junction", "scan_ring")}.get(archetype,
                         ("inspection podium", "rune_pulse" if surface in ("grass", "stone") else "scan_ring"))
    target = {"sorter": "signal receiver", "threshold": "barrier beacon", "audit": "evidence tray"}.get(archetype, style)
    def zone(x):
        return dict(x=x, y=.48, width=.14, height=.14, style=target,
                    reaction="beacon_flash" if archetype in ("sorter","threshold") else "gate_open")
    return dict(surface=dict(type=surface, speedMultiplier=preset["speedMultiplier"], drag=preset["drag"], trailStyle=preset["trailStyle"],
                             trailColor=env.get("accent_color", "#b4c8ce")),
                structures=dict(entry=dict(x=.5,y=.22,style=style,label=env.get("setting_name") or "Entry"),
                                checkpoint=dict(x=.5,y=.5,radius=.06,style=scanner,reaction=reaction),
                                leftTarget=zone(.24),rightTarget=zone(.76)),
                obstacles=[dict(id="west",x=.125,y=.79,w=.055,h=.08,kind=kind),
                           dict(id="east",x=.875,y=.72+.025*level,w=.06,h=.07,kind=kind)])


def geometry_error(world):
    structures = world["structures"]
    entry, check = structures["entry"], structures["checkpoint"]
    def box(item, width, height):
        return (item["x"]-width/2, item["y"]-height/2, item["x"]+width/2, item["y"]+height/2)
    def meets(a,b):
        return a[0]<b[2]+.025 and a[2]+.025>b[0] and a[1]<b[3]+.025 and a[3]+.025>b[1]
    occupied = [box(entry,.08,.08), box(check,2*check["radius"],2*check["radius"])]
    occupied.extend(box(z,z["width"],z["height"]) for z in (structures["leftTarget"],structures["rightTarget"]))
    if not structures["leftTarget"]["x"] < check["x"] < structures["rightTarget"]["x"] or entry["y"] >= check["y"]:
        return "Place targets on opposite sides of the checkpoint and the entry above it."
    boxes = occupied + [box(o,o["w"],o["h"]) for o in world["obstacles"]]
    if any(min(b[:2])<.02 or max(b[2:])>.98 for b in boxes):
        return "Map footprints must fit inside the arena."
    if any(meets(b,other) for i,b in enumerate(boxes) for other in boxes[:i]):
        return "Separate structure and obstacle footprints with walking clearance."
    lane = (min(entry["x"],check["x"])-.045,entry["y"],max(entry["x"],check["x"])+.045,check["y"])
    if any(meets(b,lane) for b in boxes[len(occupied):]):
        return "Keep the entry-to-checkpoint lane clear."
    vents = [box(v,.06,.06) for v in world.get("hazards",[]) if isinstance(v,dict) and "x" in v]
    if any(meets(vent,other) for i,vent in enumerate(vents) for other in boxes+vents[:i]):
        return "Keep hazards clear of landmarks, obstacles and each other."
    if len({o["id"] for o in world["obstacles"]}) != len(world["obstacles"]):
        return "Give each obstacle a unique id."
