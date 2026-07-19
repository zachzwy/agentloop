import path from "node:path";

export function outsideCwd(p) {
  const resolved = path.resolve(p);
  return (
    resolved !== process.cwd() && !resolved.startsWith(process.cwd() + path.sep)
  );
}
