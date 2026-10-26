// 航路（ステージ）の定義。サーバー（lib/game.mjs）と画面の両方が読む。
// 数は既定の長さ（goalDist）のときの個数。e2e などで長さを変えると、長さに比例して増減する。
//   fields: 岩場（ナビにしか見えない。中にいると船体が削れる）
//   storms: 電磁嵐（ナビにしか見えない。電力が減り、故障しやすい）
//   wells:  重力井戸（全員に見える。吸い込まれ、中心では船体が削れる）
//   pods:   補給ポッド（全員に見える。拾うと船体・酸素・電力が戻る）
//   meteor / fail: 隕石と自然故障の起きやすさ（倍率）
//   events: 途中で起きる出来事。shower=流星群 / wind=太陽風 / cat=宇宙ネコ。eventFrom の区間から起きる
//   sections: 区間の数。区間の境目に中継ラインがあり、越えると残り時間が増え（gateBonus 秒）、船体が少し直り、難しくなる
export const ROUTES = {
  moon: {
    name: '月までおつかい', lead: '短くてやさしい。まずはここで練習', theme: 'moon',
    goalDist: 4200, timeLimit: 120, fields: 3, storms: 1, wells: 0, pods: 3,
    meteor: 0.75, fail: 0.75, events: ['shower'], eventFrom: 2, sections: 3, gateBonus: 15
  },
  belt: {
    name: '小惑星帯', lead: '岩場だらけ。ナビの声が命', theme: 'belt',
    goalDist: 6000, timeLimit: 150, fields: 8, storms: 2, wells: 0, pods: 4,
    meteor: 1.1, fail: 1, events: ['shower', 'cat'], eventFrom: 1, sections: 3, gateBonus: 20
  },
  storm: {
    name: '電磁嵐の海', lead: '故障が止まらない。修理が大忙し', theme: 'storm',
    goalDist: 6000, timeLimit: 150, fields: 2, storms: 8, wells: 0, pods: 5,
    meteor: 0.9, fail: 1.35, events: ['cat', 'wind'], eventFrom: 1, sections: 3, gateBonus: 20
  },
  hole: {
    name: 'ブラックホールの縁', lead: '吸い込まれる。舵とエンジンの勝負', theme: 'hole',
    goalDist: 6600, timeLimit: 165, fields: 3, storms: 3, wells: 3, pods: 5,
    meteor: 1, fail: 1, events: ['wind', 'shower'], eventFrom: 1, sections: 3, gateBonus: 20
  },
  long: {
    name: '銀河横断', lead: 'ロング。全部入りで5区間', theme: 'galaxy', long: true,
    goalDist: 15000, timeLimit: 260, fields: 12, storms: 9, wells: 4, pods: 18,
    meteor: 0.95, fail: 0.95, events: ['shower', 'cat', 'wind'], eventFrom: 1, sections: 5, gateBonus: 30
  }
}
export const ROUTE_IDS = Object.keys(ROUTES)
export const DEFAULT_ROUTE = 'belt'

// 出来事の名前（画面の帯と結果に出す）
export const EVENT_NAMES = { shower: '流星群', wind: '太陽風', cat: '宇宙ネコ' }
// 補給ポッドの種類
export const POD_KINDS = ['hull', 'o2', 'energy']
export const POD_NAMES = { hull: '修理キット', o2: '酸素ボンベ', energy: '電池' }
// クルーの色（席の番号順）。帽子・吹き出し・名簿で使う
export const CREW_COLORS = ['#ff8a1f', '#3ef0b0', '#4fd8ff', '#c86bff', '#ff4a5e', '#ffd23f', '#8f9bff', '#ff7ab8']
