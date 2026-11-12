const { cp, access } = require("node:fs/promises");
const { join, basename } = require("node:path");

// electron-builder deliberately filters node_modules out of ordinary file sets.
// Next's traced runtime is a separate, already-minimised dependency set.
exports.default = async context => {
  const target = join(context.appOutDir, "resources", "frontend", "node_modules");
  await cp(join(__dirname, "frontend", "node_modules"), target, {
    recursive: true,
    force: true,
    filter: source => { const name = basename(source); return name !== ".env" && !name.startsWith(".env.") && !name.endsWith(".sqlite") && !name.includes("setup-key"); },
  });
  await access(join(target, "next", "package.json"));
  await access(join(target, "react", "package.json"));
};
