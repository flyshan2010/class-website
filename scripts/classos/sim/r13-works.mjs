/**
 * R13 作品入庫只讀演練（SPEC_R13作品入庫腳本.md §4）
 * 不連 Notion、不寫任何資料：答案寫死在題目裡——規則一漂，這支就會 FAIL。
 * ⚠️ PUBLIC repo：只用虛構座號、虛構頁面 id 與虛構網址，不含任何學生資料。
 * 執行：node scripts/classos/sim/r13-works.mjs
 */
import {
  isR13, parseSentence, workName, workType, seatFromFilename, assignPhotos, planTask, execLog,
} from "../lib/r13-works.mjs";

let n = 0, fail = 0;
const eq = (name, got, want) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}：得到 ${g}，應為 ${w}`); }
};
const f = (name) => ({ name, url: `https://drive.google.com/file/d/FAKE-${name}/view`, external: true });
const weeks = { 學期: [{ 週: [{ 起: "2026-09-28", 迄: "2026-10-04", 標籤: "四上第5週(9/28-10/2)" }] }] };
const roster = new Map([[3, "p3"], [5, "p5"], [12, "p12"], [19, "p19"], [23, "p23"]]);
const ctx = { roster, weeks, existing: new Set() };
const D = "2026-09-29";

// ── 路由 ──
eq("路由：附件＋作品", isR13("19 23 教師節繪畫比賽作品", 2), true);
eq("路由：附件＋佳作", isR13("座號5 書法佳作", 1), true);
eq("路由：沒附件不算", isR13("座號5 作品 水彩", 0), false);
eq("路由：附件＋成績單不算", isR13("這是這次的成績單", 1), false);
eq("路由：R18 指紋不算", isR13("#CM-EVENTS v1 · 作品\n{}", 1), false);

// ── 座號解析 ──
eq("座號：空白分隔", parseSentence("19 23 教師節繪畫比賽作品"), { ok: true, seats: [19, 23], rest: "教師節繪畫比賽作品" });
eq("座號：座號N 作品", parseSentence("座號12 作品 水彩畫〈夏天〉"), { ok: true, seats: [12], rest: "作品 水彩畫〈夏天〉" });
eq("座號：和／的", parseSentence("座號3和5的合作海報"), { ok: true, seats: [3, 5], rest: "合作海報" });
eq("座號：頓號＋號", parseSentence("3、5號 作品 小書"), { ok: true, seats: [3, 5], rest: "作品 小書" });
eq("座號：這是…前綴", parseSentence("這是座號12的美勞作品"), { ok: true, seats: [12], rest: "美勞作品" });
eq("座號：上傳作品：前綴", parseSentence("上傳作品：座號5 的讀書心得"), { ok: true, seats: [5], rest: "讀書心得" });
eq("座號：重複去重", parseSentence("5 5 作品").seats, [5]);
eq("座號：日期開頭 E03", parseSentence("9/29 繪畫作品").code, "E03");
eq("座號：區間 E03", parseSentence("座號1-3 作品").code, "E03");
eq("座號：三位數 E03", parseSentence("座號123 作品").code, "E03");
eq("座號：沒有 E01", parseSentence("教師節繪畫比賽作品").code, "E01");

// ── 作品名／類型 ──
eq("名：作品後文字", workName("作品 水彩畫〈夏天〉", "美勞", D), "水彩畫〈夏天〉");
eq("名：整句", workName("教師節繪畫比賽作品", "美勞", D), "教師節繪畫比賽作品");
eq("名：去掉全包引號", workName("作品「我的家」", "其他", D), "我的家");
eq("名：空→預設", workName("作品", "美勞", D), "9/29美勞作品");
eq("名：空＋其他", workName("", "其他", D), "9/29作品");
eq("類型：畫→美勞", workType("教師節繪畫比賽作品"), "美勞");
eq("類型：心得→寫作", workType("讀書心得作品"), "寫作");
eq("類型：數學", workType("數學 小書 作品"), "數學");
eq("類型：其他", workType("科展 作品"), "其他");

// ── 檔名座號 ──
eq("檔名：代理時間戳", seatFromFilename("20260929-140428_19教師節繪畫比賽.jpg", [19, 23]), 19);
eq("檔名：座號N", seatFromFilename("座號23.png", [19, 23]), 23);
eq("檔名：IMG_0019 不算", seatFromFilename("IMG_0019.jpg", [19, 23]), null);
eq("檔名：舊版附件N 不算", seatFromFilename("附件1", [1, 2]), null);
eq("檔名：兩個座號都在 → 不猜", seatFromFilename("19和23.jpg", [19, 23]), null);
eq("檔名：不在句中座號", seatFromFilename("5水彩.jpg", [19, 23]), null);

// ── 照片分配 ──
const one = assignPhotos([19, 23], [f("合照.jpg")]);
eq("分配：多座號一張＝共用", [...one.bySeat.values()].map((a) => a.length), [1, 1]);
const two = assignPhotos([19, 23], [f("20260929-140437_23畫.jpg"), f("20260929-140428_19畫.jpg")]);
eq("分配：依檔名（順序顛倒也對）", [two.bySeat.get(19)[0].name, two.bySeat.get(23)[0].name], ["20260929-140428_19畫.jpg", "20260929-140437_23畫.jpg"]);
const single = assignPhotos([12], [f("a.jpg"), f("b.jpg")]);
eq("分配：單座號全給", single.bySeat.get(12).length, 2);
const bad = assignPhotos([19, 23], [f("附件1"), f("附件2")]);
eq("分配：舊版附件N → 待審", bad.ok, false);
eq("分配：待審理由", bad.why, "第1張、第2張照片檔名對不到座號；座號19、23沒有分到照片（多位學生多張照片時，檔名請帶座號，例如 19教師節畫.jpg）");
const lack = assignPhotos([19, 23], [f("19a.jpg"), f("19b.jpg")]);
eq("分配：有人沒分到 → 待審", lack.why.startsWith("座號23沒有分到照片"), true);

// ── 整件規劃 ──
const plan = planTask({ text: "19 23 教師節繪畫比賽作品", files: [f("20260929-140428_19教師節繪畫比賽.jpg"), f("20260929-140437_23教師節繪畫比賽.jpg")], date: D }, ctx);
eq("整件：可寫", plan.status, "write");
eq("整件：兩列", plan.rows.map((r) => [r.seat, r.photos, r.action]), [[19, 1, "write"], [23, 1, "write"]]);
eq("整件：週次", plan.week, "四上第5週(9/28-10/2)");
eq("整件：學年", plan.year, "115");
eq("整件：relation", plan.rows[1].props.學生.relation, [{ id: "p23" }]);
eq("整件：照片外部連結", plan.rows[0].props.照片.files[0].external.url, "https://drive.google.com/file/d/FAKE-20260929-140428_19教師節繪畫比賽.jpg/view");
eq("整件：發布勾", plan.rows[0].props.發布.checkbox, true);
eq("整件：執行紀錄", execLog(plan), "已入庫作品〈教師節繪畫比賽作品〉：座號19（1張）、座號23（1張）（美勞），將出現在四上第5週報告");
const again = planTask({ text: "19 23 教師節繪畫比賽作品", files: [f("19.jpg"), f("23.jpg")], date: D },
  { ...ctx, existing: new Set(["19|教師節繪畫比賽作品|2026-09-29"]) });
eq("整件：重送略過已入庫", again.rows.map((r) => r.action), ["skip", "write"]);
eq("整件：無照片 E61", planTask({ text: "座號5 作品", files: [], date: D }, ctx).code, "E61");
eq("整件：非在學 E01", planTask({ text: "座號7 作品", files: [f("a.jpg")], date: D }, ctx).why, "座號7不在名冊或已不在學");
eq("整件：Notion 上傳檔 → 待審", planTask({ text: "座號5 作品", files: [{ name: "a.jpg", url: "x", external: false }], date: D }, ctx).status, "review");
eq("整件：假期週次留空", planTask({ text: "座號5 作品", files: [f("a.jpg")], date: "2026-07-10" }, ctx).rows[0].props.週次.rich_text, []);
eq("整件：假期執行紀錄", execLog(planTask({ text: "座號5 作品", files: [f("a.jpg")], date: "2026-07-10" }, ctx)), "已入庫作品〈7/10作品〉：座號5（1張）（其他），將收錄於期末作品牆");

console.log(`R13 規則演練 ${n} 題／失敗 ${fail} 題`);
process.exitCode = fail ? 1 : 0;
