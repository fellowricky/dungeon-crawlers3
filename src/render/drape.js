/* Lay a horizontal mesh over the terrain, so a ground effect runs up steps and raised
   floors instead of passing through them. Each vertex takes the highest ground just
   around it: where the floor steps up the sheet lifts a touch early, so the slope
   between two vertices clears the corner of the step rather than cutting into it. */
const REACH = 0.06;   // how far round each vertex to look; about half the meshes' spacing

/** `geo` is in a space whose origin is at world (cx, baseY, cz) and unrotated.
 *  `heightAt(x, z)` is the world floor height; `lift` keeps the sheet just proud of it. */
export function drapeGeometry(geo, cx, cz, baseY, heightAt, lift = 0.03) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = cx + p.getX(i), z = cz + p.getZ(i);
    const h = Math.max(
      heightAt(x, z),
      heightAt(x + REACH, z), heightAt(x - REACH, z),
      heightAt(x, z + REACH), heightAt(x, z - REACH),
    );
    p.setY(i, h - baseY + lift);
  }
  p.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}
