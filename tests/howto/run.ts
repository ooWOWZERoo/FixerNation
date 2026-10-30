/**
 * Records one how-to video:   npm run howto -- B1
 * (the npm script adds --env-file=tests/howto/.env.howto.local; start the site first with tests/howto/stack.sh up)
 */
import { produce } from "./pipeline";

const id = process.argv[2];
if (!id) { console.error("Usage: npm run howto -- <ID>   e.g. B1"); process.exit(1); }

(async () => {
  const mod = await import(`./storyboards/${id}`).catch(() => null);
  if (!mod) { console.error(`No storyboard for ${id} in tests/howto/storyboards/`); process.exit(1); }
  await produce(mod.default);
})().catch((e) => { console.error(e); process.exit(1); });
