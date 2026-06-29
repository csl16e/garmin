// Garmin Dashboard Widget for Scriptable
// Install Scriptable (free) from the App Store, paste this script, then
// long-press your home screen → + → Scriptable → pick "GarminWidget"

const DATA_URL = "https://csl16e.github.io/garmin/garmin/data.json"
const CACHE_KEY = "garmin_widget_cache"
const TEAL = new Color("#00c4b0")
const TEAL_DIM = new Color("#00c4b033")
const BG = new Color("#0d1117")
const BG2 = new Color("#161b22")
const MUTED = new Color("#6b7280")
const TEXT = Color.white()
const YELLOW = new Color("#f59e0b")
const RED = new Color("#ef4444")
const GREEN = new Color("#22c55e")

// ── helpers ─────────────────────────────────────────────────────────────────

function mi(meters) { return meters / 1609.34 }

function fmtPace(mps) {
  if (!mps || mps <= 0) return "—"
  const mpmi = 26.8224 / mps
  const m = Math.floor(mpmi)
  const s = Math.round((mpmi - m) * 60)
  return `${m}:${String(s).padStart(2,"0")}`
}

function fmtMi(meters) {
  return `${mi(meters || 0).toFixed(2)} mi`
}

function fmtDur(secs) {
  if (!secs) return "—"
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function readinessColor(v) {
  if (v == null) return MUTED
  if (v >= 75) return GREEN
  if (v >= 50) return TEAL
  if (v >= 25) return YELLOW
  return RED
}

function sleepColor(v) {
  if (v == null) return MUTED
  if (v >= 80) return GREEN
  if (v >= 60) return TEAL
  if (v >= 40) return YELLOW
  return RED
}

function calcStreak(runs) {
  const dates = new Set(runs.map(r => r.startTimeLocal?.slice(0, 10)))
  let streak = 0
  const d = new Date()
  for (let i = 0; i < 60; i++) {
    const ds = d.toISOString().slice(0, 10)
    if (dates.has(ds)) streak++
    else if (streak > 0) break
    d.setDate(d.getDate() - 1)
  }
  return streak
}

function nextRunRec(runs, wellness) {
  const today = wellness[0] || {}
  const tr = today.training_readiness
  const last5 = runs.slice(0, 5)
  const avgMps = last5.filter(r => r.averageSpeed).reduce((s, r) => s + r.averageSpeed, 0) / (last5.filter(r => r.averageSpeed).length || 1)
  const wmi = runs.filter(r => (new Date() - new Date(r.startTimeLocal)) < 7 * 86400000).reduce((s, r) => s + mi(r.distance || 0), 0)
  const daysSince = runs[0] ? (new Date() - new Date(runs[0].startTimeLocal)) / 86400000 : 999
  const ep = avgMps ? avgMps * 0.88 : null

  if (tr != null && tr < 50) return { type: "Rest Day", emoji: "🛑", pace: null, dist: null, note: "Readiness low — recover today" }
  if (tr != null && tr >= 80 && wmi < 9 && daysSince >= 1) return { type: "Tempo Run", emoji: "🔥", pace: avgMps ? avgMps * 1.08 : null, dist: (mi(runs.slice(0,5).reduce((s,r)=>s+(r.distance||0),0)/5)*1.1), note: "High readiness — push hard" }
  if (wmi > 12) return { type: "Easy Recovery", emoji: "🌿", pace: ep, dist: (mi(runs.slice(0,5).reduce((s,r)=>s+(r.distance||0),0)/5)*0.75), note: "High weekly load — back off" }
  return { type: "Base Run", emoji: "🏃", pace: ep, dist: (mi(runs.slice(0,5).reduce((s,r)=>s+(r.distance||0),0)/5)*1.05), note: "Steady Zone 2 effort" }
}

function sleepTip(wellness) {
  const recent = wellness.filter(w => w.sleep_score != null).slice(0, 7)
  if (!recent.length) return null
  const avg = recent.reduce((s, w) => s + w.sleep_score, 0) / recent.length
  const avgHrs = wellness.filter(w => w.sleep_seconds).slice(0, 7).reduce((s, w) => s + w.sleep_seconds / 3600, 0) / (wellness.filter(w => w.sleep_seconds).length || 1)
  if (avg < 60) return "Poor sleep lately — aim for 10pm bedtime tonight"
  if (avgHrs < 6.5) return "Averaging under 7h — try getting to bed 30 min earlier"
  if (avg >= 80) return "Great sleep streak — keep the same schedule"
  return "Consistent bedtime improves score. Avoid screens after 10pm"
}

// ── fetch data ───────────────────────────────────────────────────────────────

async function fetchData() {
  const fm = FileManager.local()
  const cachePath = fm.joinPath(fm.temporaryDirectory(), CACHE_KEY + ".json")

  try {
    const req = new Request(DATA_URL)
    req.timeoutInterval = 8
    const data = await req.loadJSON()
    fm.writeString(cachePath, JSON.stringify(data))
    return data
  } catch (e) {
    // Fall back to cache if offline
    if (fm.fileExists(cachePath)) {
      return JSON.parse(fm.readString(cachePath))
    }
    return null
  }
}

// ── build widget ─────────────────────────────────────────────────────────────

async function buildWidget(data) {
  const w = new ListWidget()
  w.backgroundColor = BG
  w.setPadding(14, 16, 14, 16)
  w.url = "https://csl16e.github.io/garmin"

  if (!data) {
    const t = w.addText("⚠️ No data")
    t.textColor = MUTED
    t.font = Font.mediumSystemFont(14)
    return w
  }

  const wellness = (data.wellness || []).sort((a, b) => b.date.localeCompare(a.date))
  const runs = (data.activities || [])
    .filter(a => a.activityType?.typeKey === "running" || a.activityType?.typeKey === "treadmill_running")
    .sort((a, b) => b.startTimeLocal.localeCompare(a.startTimeLocal))

  const today = wellness[0] || {}
  const lastRun = runs[0]
  const streak = calcStreak(runs)
  const sleepDay = wellness.find(w => w.sleep_score != null) || {}
  const rec = nextRunRec(runs, wellness)
  const tip = sleepTip(wellness)

  const family = config.widgetFamily || "large"

  // ── HEADER ROW ────────────────────────────────────────────────────────────
  const header = w.addStack()
  header.layoutHorizontally()
  header.centerAlignContent()

  const logo = header.addText("⚡ Garmin")
  logo.textColor = TEAL
  logo.font = Font.boldSystemFont(13)

  header.addSpacer()

  const syncDate = (data.activities || []).length ? new Date((data.activities[0].startTimeLocal || "")).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""
  const syncLbl = header.addText(syncDate)
  syncLbl.textColor = MUTED
  syncLbl.font = Font.systemFont(10)

  w.addSpacer(8)

  // ── TOP STATS ROW (readiness · streak · sleep) ────────────────────────────
  const statsRow = w.addStack()
  statsRow.layoutHorizontally()
  statsRow.spacing = 0

  function statBlock(stack, emoji, value, label, color) {
    const col = stack.addStack()
    col.layoutVertically()
    col.centerAlignContent()

    const top = col.addStack()
    top.layoutHorizontally()
    top.centerAlignContent()
    const ico = top.addText(emoji + " ")
    ico.textColor = color
    ico.font = Font.boldSystemFont(11)
    const val = top.addText(String(value))
    val.textColor = color
    val.font = Font.boldSystemFont(20)

    col.addSpacer(1)
    const lbl = col.addText(label)
    lbl.textColor = MUTED
    lbl.font = Font.systemFont(9)
    lbl.centerAlignText()
  }

  const tr = today.training_readiness
  statBlock(statsRow, "💪", tr ?? "—", "Readiness", readinessColor(tr))
  statsRow.addSpacer()
  statBlock(statsRow, "🔥", streak || "0", streak === 1 ? "day streak" : "day streak", YELLOW)
  statsRow.addSpacer()
  const ss = sleepDay.sleep_score
  statBlock(statsRow, "😴", ss ?? "—", "Sleep Score", sleepColor(ss))

  w.addSpacer(10)

  // ── DIVIDER ───────────────────────────────────────────────────────────────
  function divider() {
    const d = w.addStack()
    d.backgroundColor = new Color("#ffffff11")
    d.size = new Size(0, 1)
    w.addSpacer(8)
  }
  divider()

  // ── LAST RUN ──────────────────────────────────────────────────────────────
  const runHdr = w.addText("LAST RUN")
  runHdr.textColor = MUTED
  runHdr.font = Font.boldSystemFont(8)

  w.addSpacer(4)

  if (lastRun) {
    const runRow = w.addStack()
    runRow.layoutHorizontally()
    runRow.centerAlignContent()

    const runName = runRow.addText(lastRun.activityName || "Run")
    runName.textColor = TEXT
    runName.font = Font.mediumSystemFont(13)
    runName.lineLimit = 1

    runRow.addSpacer()

    const distLbl = runRow.addText(fmtMi(lastRun.distance))
    distLbl.textColor = TEAL
    distLbl.font = Font.boldSystemFont(15)

    w.addSpacer(3)

    const runMeta = w.addStack()
    runMeta.layoutHorizontally()
    runMeta.spacing = 8

    const dateStr = new Date(lastRun.startTimeLocal).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    const metaItems = [dateStr, fmtPace(lastRun.averageSpeed) + "/mi", fmtDur(lastRun.duration)]
    metaItems.forEach(item => {
      const t = runMeta.addText(item)
      t.textColor = MUTED
      t.font = Font.systemFont(10)
    })
  } else {
    const noRun = w.addText("No recent runs")
    noRun.textColor = MUTED
    noRun.font = Font.systemFont(11)
  }

  // ── LARGE ONLY: extra sections ────────────────────────────────────────────
  if (family === "large" || family === "extraLarge") {
    w.addSpacer(10)
    divider()

    // Recommended run
    const recHdr = w.addText("TODAY'S RUN")
    recHdr.textColor = MUTED
    recHdr.font = Font.boldSystemFont(8)

    w.addSpacer(4)

    const recRow = w.addStack()
    recRow.layoutHorizontally()
    recRow.centerAlignContent()

    const recType = recRow.addText(rec.emoji + " " + rec.type)
    recType.textColor = TEXT
    recType.font = Font.boldSystemFont(13)

    recRow.addSpacer()

    if (rec.pace && rec.dist) {
      const recPace = recRow.addText(fmtPace(rec.pace) + "/mi")
      recPace.textColor = TEAL
      recPace.font = Font.boldSystemFont(12)
    }

    w.addSpacer(3)
    const recNote = w.addText(rec.note)
    recNote.textColor = MUTED
    recNote.font = Font.systemFont(10)

    w.addSpacer(10)
    divider()

    // Sleep tip
    const sleepHdr = w.addText("SLEEP TIP")
    sleepHdr.textColor = MUTED
    sleepHdr.font = Font.boldSystemFont(8)

    w.addSpacer(4)

    const sleepRow = w.addStack()
    sleepRow.layoutHorizontally()
    sleepRow.spacing = 8

    if (sleepDay.sleep_seconds) {
      const hrs = (sleepDay.sleep_seconds / 3600).toFixed(1)
      const hrsLbl = sleepRow.addText("🌙 " + hrs + "h last night")
      hrsLbl.textColor = sleepColor(ss)
      hrsLbl.font = Font.mediumSystemFont(12)
    }

    if (tip) {
      w.addSpacer(3)
      const tipLbl = w.addText(tip)
      tipLbl.textColor = MUTED
      tipLbl.font = Font.systemFont(10)
      tipLbl.lineLimit = 2
    }
  }

  w.addSpacer()

  // ── FOOTER ────────────────────────────────────────────────────────────────
  const footer = w.addStack()
  footer.layoutHorizontally()
  footer.centerAlignContent()

  const week7mi = runs.filter(r => (new Date() - new Date(r.startTimeLocal)) < 7 * 86400000).reduce((s, r) => s + mi(r.distance || 0), 0)
  const weekLbl = footer.addText(`This week: ${week7mi.toFixed(1)} mi`)
  weekLbl.textColor = MUTED
  weekLbl.font = Font.systemFont(9)

  footer.addSpacer()

  const nowStr = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  const updLbl = footer.addText("Updated " + nowStr)
  updLbl.textColor = new Color("#ffffff22")
  updLbl.font = Font.systemFont(9)

  return w
}

// ── run ──────────────────────────────────────────────────────────────────────

const data = await fetchData()
const widget = await buildWidget(data)

if (config.runInWidget) {
  Script.setWidget(widget)
} else {
  widget.presentLarge()
}
Script.complete()
