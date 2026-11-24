"""Build connected 20 by 12 maps in the same coordinate system as world_physics."""
from collections import deque

WIDTH, HEIGHT = 20, 12
MARKERS = {"S":"entry", "?":"checkpoint", "L":"leftTarget", "R":"rightTarget"}


def valid_tilemap(rows, level):
    if not isinstance(rows, list) or len(rows) != HEIGHT:
        return False
    if any(not isinstance(row, str) or len(row) != WIDTH or set(row) - set(".#?~LRS") for row in rows):
        return False
    tiles = "".join(rows)
    if any(tiles.count(c) != 1 for c in MARKERS):
        return False
    if level >= 2 and "#" not in tiles or level == 3 and "~" not in tiles:
        return False
    if not 1 <= tiles.count("#") <= 2:
        return False
    positions = {symbol: (tiles.index(symbol) % WIDTH, tiles.index(symbol) // WIDTH) for symbol in MARKERS}
    if not positions["L"][0] < positions["?"][0] < positions["R"][0]:
        return False
    queue = deque([positions["S"]])
    seen = set(queue)
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
            if 0 <= nx < WIDTH and 0 <= ny < HEIGHT and rows[ny][nx] != "#" and (nx, ny) not in seen:
                seen.add((nx, ny))
                queue.append((nx, ny))
    return all(point in seen for point in positions.values())


def curated_tilemap(world, level):
    grid = [["."]*WIDTH for _ in range(HEIGHT)]
    for symbol, name in MARKERS.items():
        pos = world["structures"][name]
        grid[int(pos["y"]*HEIGHT)][int(pos["x"]*WIDTH)] = symbol
    obstacles = world["obstacles"]
    props = [(int(o["x"]*WIDTH),int(o["y"]*HEIGHT)) for o in obstacles]

    for x,y in props:
        if grid[y][x]==".":
            grid[y][x]="#"
    if level==3:
        for y in (4,5,6):
            for x in (8,9,10,11):
                if grid[y][x]==".":
                    grid[y][x]="~"
    return ["".join(row) for row in grid]


def clear_walking_lanes(rows, world):
    """Keep physical props and their collision tiles together on the arena perimeter."""
    grid = [list(row.replace("#", ".")) for row in rows]
    landmarks = [(x,y) for y,row in enumerate(rows) for x,tile in enumerate(row) if tile in MARKERS]
    # Also respect the continuous footprints when a provider overrides just the tilemap.
    landmarks += [(int(s["x"]*WIDTH),int(s["y"]*HEIGHT)) for s in world["structures"].values()]
    for prop in world["obstacles"]:
        prop["w"] = min(prop["w"], .06)
        prop["h"] = min(prop["h"], .085)
        old = int(prop["x"]*WIDTH), int(prop["y"]*HEIGHT)
        candidates = [old, (2,9), (17,10), (2,2), (17,2)]
        candidates += [(x,y) for y in range(1,HEIGHT-1) for x in (2,17)]
        def clearance(cell):
            x,y = cell
            if not (1<=x<WIDTH-1 and 1<=y<HEIGHT-1 and grid[y][x] in ".~"):
                return -1
            if any(grid[ny][nx]=="#" for ny in range(y-1,y+2) for nx in range(x-1,x+2)):
                return -1
            return min(abs(y-ly) if abs(x-lx)<4 else abs(x-lx) for lx,ly in landmarks)
        preferred = next((c for c in candidates if (c[0]<4 or c[0]>=16) and clearance(c)>=3),None)
        x,y = preferred or max(candidates,key=clearance)
        grid[y][x] = "#"
        if (x,y)!=old:
            prop.update(x=(x+.5)/WIDTH,y=(y+.5)/HEIGHT)
    return ["".join(row) for row in grid]
