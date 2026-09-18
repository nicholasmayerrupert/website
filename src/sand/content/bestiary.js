import { CREATURE } from '../wasmBridge/abi.generated.js';
// These names describe the creatures encountered in the Hollow Bell chapter.
export const BESTIARY = {
  [CREATURE.PIKE]: { name: 'Silverfang pike', note: 'A flash beneath the water. Fight from a bank or change the current.' },
  [CREATURE.FOX]: { name: 'Ember fox', note: 'A wary woodland hunter. It follows small prey and leaves travelers alone.' },
  [CREATURE.CRAWLER]: { name: 'Mossback crawler', note: 'A low silhouette in the roots. Spears keep its bite at a distance.' },
  [CREATURE.BRIAR_GOBLIN]: { name: 'Briar goblin', note: 'Watch its marked patch of ground. It cannot redirect a strike once the warning appears.' },
  [CREATURE.FEN_WITCH]: { name: 'Fen witch', note: 'Its curse settles where you stood. Keep moving through the marsh.' },
  [CREATURE.OATHLESS_ARCHER]: { name: 'Oathless archer', note: 'The old roads still have sentries. Raise a shield toward the threat.' },
  [CREATURE.BRIAR_WOLF]: { name: 'Briar wolf', note: 'Antlers of root and a dangerous rush. Let its charge carry it past you.' },
  [CREATURE.BELL_BAT]: { name: 'Bell bat', note: 'A flutter in the rafters. Short bursts of magic work well in narrow galleries.' },
  [CREATURE.BONE_GUARD]: { name: 'Bone guard', note: 'Clattering feet betray its approach. Break its line with a dodge.' },
  [CREATURE.FEN_WISP]: { name: 'Fen wisp', note: 'A wandering light above the silt. Keep dry ground beneath your feet.' },
  [CREATURE.CINDERJAW_DRAGON]: { name: 'Cinderjaw Dragon', note: 'A winged skeleton prowling the bone highlands. Evade its snapping jaws and committed rush; when its ribs kindle, get behind the sustained flame breath and punish the recovery.' },
  [CREATURE.FROST_GIANT]: { name: 'Frost giant', note: 'Raised fists break the ground. Sidestep its sustained breath, watch for ice underfoot, and dodge the great shard forming in its hands.' },
  [CREATURE.STONE_GUARDIAN]: { name: 'Stone Guardian', note: 'The archive’s forgotten guardian. Its broad strikes can also reshape the room.' },
  [CREATURE.ROOT_KNIGHT]: { name: 'Root Knight', note: 'A stubborn oath protects the shrine. Roots can hold even this warrior in place.' },
  [CREATURE.THORNBOUND_HART]: { name: 'Thornbound Hart', note: 'Charge, thornfall, then a widening ring. The wounded hart shortens its warning.' },
  [CREATURE.MIRE_MATRON]: { name: 'Mire Matron', note: 'Her pools spread as the fight deepens. Drain them or turn water to ice.' },
  [CREATURE.CINDER_CASTELLAN]: { name: 'Cinder Castellan', note: 'The hammer breaks stone as well as bone. Keep a way out of the court.' },
  [CREATURE.HOLLOW_BELLKEEPER]: { name: 'Hollow Bellkeeper', note: 'Read the widening circles and move through their gaps. The final note belongs to you.' },
};
