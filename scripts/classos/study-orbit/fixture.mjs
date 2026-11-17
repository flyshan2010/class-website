// 測試共用的合格資料包（check.test.mjs、books.test.mjs 共用）
// 合格資料包：一本題本兩關。L1＝七格選擇題；L2＝配合題（第 1–4 格）＋題組（第 5–7 格）
export const BOOK = "m-x-t1";
export const L1 = `${BOOK}-1-1`, L2 = `${BOOK}-1-2`;
const STORY = "這是延伸小知識。".repeat(6); // 48 字
let n = 0;
const qid = () => `MA4-${String(++n).padStart(4, "0")}`;
const choice = (level, slot, mother, extra = {}) => ({
  id: qid(), type: "選擇", level, slot, span: 1, mother, kp: `${level}-K1`,
  blindspots: [`${level}-B1`, `${level}-B2`, `${level}-B3`],
  optionBlindspots: `B=${level}-B1\nC=${level}-B2\nD=${level}-B3`,
  options: [`甲${n}`, `乙${n}`, `丙${n}`, `丁${n}`], answer: "A",
  hint1: "想一想", hint2: "看位值表", explanation: "因為……", status: "可用", ...extra,
});

export function fixture() {
  n = 0;
  const questions = [];
  for (let s = 1; s <= 7; s++) {
    const a = choice(L1, s, "");
    questions.push(a, choice(L1, s, a.id));
  }
  const match = (mother) => ({
    id: qid(), type: "配合", level: L2, slot: 1, span: 4, mother, kp: `${L2}-K1`,
    blindspots: [`${L2}-B1`, `${L2}-B2`],
    optionBlindspots: `1=${L2}-B1\n2=${L2}-B2\n3=${L2}-B1\n4=${L2}-B2`,
    left: ["一", "二", "三", "四"], right: [`甲${n}`, `乙${n}`, `丙${n}`, `丁${n}`],
    hint1: "想一想", hint2: "對照", explanation: "因為……", status: "可用",
  });
  const m1 = match("");
  questions.push(m1, match(m1.id));
  const g1 = [5, 6, 7].map((s) => choice(L2, s, "", { group: `${L2}-G1`, material: "短文甲", materialType: "文章" }));
  const g2 = g1.map((q, i) => choice(L2, 5 + i, q.id, { group: `${L2}-G2`, material: "短文乙", materialType: "文章" }));
  questions.push(...g1, ...g2);
  const bs = (level, i) => ({ code: `${level}-B${i}`, name: `盲點${i}`, kp: `${level}-K1`, level, fix: "對的想法", ex: "例子", chk: "口訣", status: "可用" });
  return {
    books: [{ code: BOOK, subject: "數學", status: "試行", structure: { islands: [{ id: "1", name: "島", levels: [
      { code: L1, name: "第一關", exam: "期中", slots: ["基礎", "基礎", "基礎", "進階", "進階", "應用", "應用"] },
      { code: L2, name: "第二關", exam: "期中", slots: ["基礎", "基礎", "基礎", "基礎", "進階", "應用", "應用"] },
    ] }] } }],
    kps: [
      { code: `${L1}-K1`, name: "重點一", subject: "數學", book: BOOK, level: L1, reviewCard: "大數", status: "可用" },
      { code: `${L2}-K1`, name: "重點二", subject: "數學", book: BOOK, level: L2, reviewCard: "", status: "可用" },
    ],
    blindspots: [1, 2, 3].flatMap((i) => [bs(L1, i), bs(L2, i)]),
    stories: [L1, L2].map((level) => ({ level, book: BOOK, title: "小知識", body: STORY, status: "可用" })),
    questions,
    reviewCards: [{ name: "大數", subject: "數學", status: "上架" }],
  };
}

