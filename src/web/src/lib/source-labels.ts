export const SOURCE_LABEL: Record<string, string> = {
  "linuxdo-welfare": "LINUX DO · 福利羊毛",
  "linuxdo-resource": "LINUX DO · 资源荟萃",
  "v2ex-free": "V2EX · 免费赠送",
  "github-free-for-dev": "GitHub · free-for-dev",
  "rss-fuliba": "福利吧",
  "rss-52pojie": "吾爱破解",
  "rss-smzdm": "什么值得买",
  "zhihu-search": "知乎 · 福利搜索",
  "xhs-search": "小红书 · 福利搜索",
  "xiaoheihe-search": "小黑盒 · 福利搜索",
  "tg-channels": "Telegram 频道",
  gamerpower: "GamerPower · 免费游戏",
  "epic-free": "Epic Games · 喜加一",
  "rss-reddit-freegames": "Reddit · FreeGameFindings",
  "rss-reddit-efreebies": "Reddit · eFreebies",
  "rss-reddit-gamedeals": "Reddit · GameDeals",
  "rss-slickdeals": "Slickdeals",
  "rss-heyitsfree": "HeyItsFree",
  "rss-keylol": "其乐 Keylol",
  "openrouter-free": "OpenRouter · 新免费大模型",
  "gamerpower-loot": "GamerPower · 免费礼包与 Key",
  "rss-itch-free": "itch.io · 100% 限免游戏",
  "rss-freesteamkeys": "FreeSteamKeys · Steam 限免",
  "rss-ghxi": "果核剥壳 · 免费软件",
};

let SOURCE_NAMES: Record<string, string> = { ...SOURCE_LABEL };
export const sourceName = (id: string) => SOURCE_NAMES[id] ?? SOURCE_LABEL[id] ?? id;

export function updateSourceNames(names: Record<string, string>) { SOURCE_NAMES = names; }
