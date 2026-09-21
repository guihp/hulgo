const fs = require("fs");
const p = "app/(print)/documentos/[tipo]/page.tsx";
const t = fs.readFileSync(p, "utf8");
const m = t.match(/beneficio = "([^"]+)"/);
if (!m) {
  console.log("not found");
  process.exit(1);
}
console.log(
  [...m[1]].map((c) => c + " U+" + c.codePointAt(0).toString(16)).join(" ")
);
