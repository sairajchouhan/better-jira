import { useState } from "react";
import { Command } from "cmdk";
import { Icon, type IconName } from "./icons";
import { MenuSurface } from "./menu-surface";

/** Linear's view colours (2026-11-11 capture). Grey is stored as "gray"; Linear fills it #bec2c8 in every theme. */
export const VIEW_COLORS = [
  ["Grey", "gray", "#bec2c8"],
  ["Dark Grey", "#95a2b3", "#95a2b3"],
  ["Purple", "#5e6ad2", "#5e6ad2"],
  ["Teal", "#26b5ce", "#26b5ce"],
  ["Green", "#4cb782", "#4cb782"],
  ["Yellow", "#f2c94c", "#f2c94c"],
  ["Orange", "#f2994a", "#f2994a"],
  ["Pink", "#f7c8c1", "#f7c8c1"],
  ["Red", "#eb5757", "#eb5757"],
] as const;

/** Every glyph in the app's icon set, grouped like Linear's picker. */
export const GLYPH_GROUPS: [string, IconName[]][] = [
  ["Views & layout", ["custom-view", "filter", "view", "layers", "board", "list", "display", "side", "search", "expand"]],
  [
    "Work",
    ["inbox", "status", "priority", "check", "flag", "flag-x", "label", "clipboard", "calendar", "clock", "bell", "star", "starred"],
  ],
  ["People & conversation", ["user", "at", "comment", "smile"]],
  [
    "Objects",
    ["file", "copy", "paperclip", "link", "branch", "pencil", "trash", "download", "external", "crop", "square-plus", "square-dots"],
  ],
  ["Arrows & symbols", ["up", "down", "chevron", "undo", "redo", "plus", "close", "dots"]],
];

const emoji = (list: string) => list.split(",").map((e) => e.trim().split(" ") as [string, string]);
/** Unicode emoji with a search word each, in the standard emoji categories Linear uses. */
export const EMOJI_GROUPS: [string, [string, string][]][] = [
  [
    "Smileys & People",
    emoji(
      "😀 grinning,😃 smiley,😄 smile,😁 grin,😆 laughing,😅 sweat,😂 joy,🙂 slight,😉 wink,😊 blush,😇 innocent,🥰 love,😍 heart-eyes,🤩 star-struck,😘 kiss,😋 yum,😎 sunglasses,🤓 nerd,🧐 monocle,🤔 thinking,🤨 raised-eyebrow,😐 neutral,😴 sleeping,🤯 exploding,🥳 party,😤 triumph,😱 scream,🥶 cold,🤖 robot,👻 ghost,💀 skull,👽 alien,👾 invader,🤡 clown,👍 thumbsup,👎 thumbsdown,👏 clap,🙌 raised-hands,🙏 pray,💪 muscle,👀 eyes,🧠 brain,🫡 salute,👋 wave,✌️ victory,🤝 handshake,🧑‍💻 technologist,🦸 superhero",
    ),
  ],
  [
    "Animals & Nature",
    emoji(
      "🐶 dog,🐱 cat,🦊 fox,🐻 bear,🐼 panda,🐨 koala,🐯 tiger,🦁 lion,🐮 cow,🐷 pig,🐸 frog,🐵 monkey,🐔 chicken,🐧 penguin,🐦 bird,🦉 owl,🦄 unicorn,🐝 bee,🐛 bug,🦋 butterfly,🐌 snail,🐞 ladybug,🐢 turtle,🐍 snake,🦖 dinosaur,🐙 octopus,🐬 dolphin,🐳 whale,🦈 shark,🌵 cactus,🌲 tree,🌴 palm,🌱 seedling,🍀 clover,🍁 maple,🍄 mushroom,🌸 blossom,🌻 sunflower,🌹 rose,🌍 earth,🌙 moon,⭐ star,🌞 sun,⛅ cloud,🌈 rainbow,❄️ snowflake,🔥 fire,💧 droplet,🌊 wave-water",
    ),
  ],
  [
    "Food & Drink",
    emoji(
      "🍎 apple,🍊 orange,🍋 lemon,🍌 banana,🍉 watermelon,🍇 grapes,🍓 strawberry,🍒 cherries,🍑 peach,🥑 avocado,🌶️ pepper,🌽 corn,🥕 carrot,🥐 croissant,🍞 bread,🧀 cheese,🍔 burger,🍟 fries,🍕 pizza,🌮 taco,🍣 sushi,🍜 ramen,🍿 popcorn,🍩 doughnut,🍪 cookie,🎂 cake,🍫 chocolate,🍬 candy,☕ coffee,🍵 tea,🧋 boba,🍺 beer,🍷 wine,🥤 cup,🧃 juice,🍽️ plate",
    ),
  ],
  [
    "Activity",
    emoji(
      "⚽ soccer,🏀 basketball,🏈 football,⚾ baseball,🎾 tennis,🏐 volleyball,🏓 ping-pong,🏸 badminton,🥊 boxing,⛳ golf,🎯 target,🎳 bowling,🏆 trophy,🥇 medal,🎮 game,🕹️ joystick,🎲 dice,🧩 puzzle,♟️ chess,🎨 art,🎭 theater,🎬 film,🎤 microphone,🎧 headphones,🎸 guitar,🎹 piano,🥁 drum,🎉 tada,🎊 confetti,🎁 gift,🏃 running,🚴 cycling,🏄 surfing,🧗 climbing,🏋️ lifting,🧘 yoga",
    ),
  ],
  [
    "Travel & Places",
    emoji(
      "🚀 rocket,✈️ airplane,🚁 helicopter,🚂 train,🚗 car,🚕 taxi,🚌 bus,🚲 bicycle,🛴 scooter,⛵ sailboat,🚢 ship,⚓ anchor,🛸 ufo,🗺️ map,🧭 compass,🏔️ mountain,🌋 volcano,🏝️ island,🏖️ beach,🏕️ camping,🏠 house,🏢 office,🏭 factory,🏰 castle,🗼 tower,🗽 liberty,🌉 bridge,🌃 night,🏙️ city,🚦 traffic,🚧 construction,⛽ fuel,🛰️ satellite,🌅 sunrise",
    ),
  ],
  [
    "Objects",
    emoji(
      "💡 idea,🔦 flashlight,💻 laptop,🖥️ desktop,⌨️ keyboard,🖱️ mouse,📱 phone,☎️ telephone,📷 camera,🎥 video,📺 tv,⏰ alarm,⏳ hourglass,⌛ timer,🔋 battery,🔌 plug,🧲 magnet,🔧 wrench,🔨 hammer,🛠️ tools,⚙️ gear,🧰 toolbox,🔩 bolt,🧪 test-tube,🔬 microscope,🔭 telescope,📡 antenna,💊 pill,🔑 key,🔒 lock,🔓 unlock,🛡️ shield,📦 package,📫 mailbox,✉️ envelope,📝 memo,📋 clipboard,📌 pin,📎 paperclip,📏 ruler,✂️ scissors,🖊️ pen,✏️ pencil,📚 books,📖 book,📓 notebook,📅 calendar,📈 chart-up,📉 chart-down,📊 bar-chart,🗂️ dividers,🗃️ card-box,🗑️ wastebasket,💰 money,💳 card,💎 gem,🏷️ label,🔔 bell,📣 megaphone,🎓 graduation,👑 crown",
    ),
  ],
  [
    "Symbols",
    emoji(
      "❤️ heart,🧡 orange-heart,💛 yellow-heart,💚 green-heart,💙 blue-heart,💜 purple-heart,🖤 black-heart,🤍 white-heart,💔 broken-heart,💯 hundred,✅ check,☑️ ballot,✔️ checkmark,❌ cross,❗ exclamation,❓ question,⚠️ warning,🚫 prohibited,⛔ no-entry,🛑 stop,♻️ recycle,✨ sparkles,⚡ lightning,💥 boom,💫 dizzy,🌀 cyclone,🔴 red-circle,🟠 orange-circle,🟡 yellow-circle,🟢 green-circle,🔵 blue-circle,🟣 purple-circle,⚫ black-circle,⚪ white-circle,🔶 diamond,🔷 blue-diamond,🔺 triangle,➕ plus,➖ minus,➡️ right,⬅️ left,⬆️ up,⬇️ down,🔁 repeat,🔄 refresh,🔀 shuffle,⏩ fast-forward,⏸️ pause,▶️ play,🆕 new,🆗 ok,🆘 sos,🔝 top,♾️ infinity,#️⃣ hash,💬 speech,💭 thought,🔗 link",
    ),
  ],
  [
    "Flags",
    emoji(
      "🏁 checkered,🚩 triangular-flag,🎌 crossed-flags,🏴 black-flag,🏳️ white-flag,🏳️‍🌈 rainbow-flag,🏴‍☠️ pirate,🇺🇸 usa,🇬🇧 uk,🇨🇦 canada,🇮🇳 india,🇩🇪 germany,🇫🇷 france,🇯🇵 japan,🇧🇷 brazil,🇦🇺 australia,🇪🇸 spain,🇮🇹 italy,🇳🇱 netherlands,🇸🇪 sweden,🇰🇷 korea,🇲🇽 mexico,🇪🇺 eu,🇺🇳 united-nations",
    ),
  ],
];

/** Linear's icon picker: Icons/Emojis tabs, then the colour row (custom colour last, after a divider), then search, then categories. */
export function ViewIconPicker({
  anchor,
  icon,
  color,
  onIcon,
  onColor,
  close,
}: {
  anchor: HTMLElement;
  icon: string;
  color: string;
  onIcon: (icon: string) => void;
  onColor: (color: string) => void;
  close: () => void;
}) {
  const [tab, setTab] = useState<"Icons" | "Emojis">(/[^\x00-\x7F]/.test(icon) ? "Emojis" : "Icons");
  const custom = !VIEW_COLORS.some(([, value]) => value === color);
  return (
    <MenuSurface label="View icon" anchor={anchor} fit close={close}>
      <div className="view-icon-picker">
        {/* Linear's picker tabs are underlined, not the pill Tabs, so they keep their own markup. */}
        <div className="view-icon-tabs">
          {(["Icons", "Emojis"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="view-color-row">
          {VIEW_COLORS.map(([label, value, swatch]) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={color === value}
              style={{ background: swatch }}
              onClick={() => onColor(value)}
            >
              {color === value && <Icon name="check" size={12} />}
            </button>
          ))}
          <span className="view-color-divider" />
          <label title="Custom color" className="view-custom-color" aria-pressed={custom}>
            {custom && <Icon name="check" size={12} />}
            <input
              aria-label="Custom color"
              type="color"
              value={custom && color.startsWith("#") ? color : "#5e6ad2"}
              onChange={(e) => onColor(e.target.value)}
            />
          </label>
        </div>
        <Command loop key={tab}>
          <Command.Input
            autoFocus
            className="view-icon-search"
            placeholder="Search icons…"
          />
          <Command.List className="view-icon-list">
            <Command.Empty className="view-icon-empty">No icons found</Command.Empty>
            {tab === "Icons"
              ? GLYPH_GROUPS.map(([group, names]) => (
                  <Command.Group key={group} heading={group}>
                    {names.map((name) => (
                      <Command.Item
                        key={name}
                        value={name}
                        keywords={[group]}
                        aria-label={name}
                        data-current={icon === name || undefined}
                        onSelect={() => onIcon(name)}
                      >
                        <Icon name={name} size={16} />
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))
              : EMOJI_GROUPS.map(([group, list]) => (
                  <Command.Group key={group} heading={group}>
                    {list.map(([glyph, name]) => (
                      <Command.Item
                        key={glyph}
                        value={`${name} ${glyph}`}
                        keywords={[group]}
                        aria-label={name}
                        onSelect={() => onIcon(glyph)}
                      >
                        {glyph}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
          </Command.List>
        </Command>
      </div>
    </MenuSurface>
  );
}
