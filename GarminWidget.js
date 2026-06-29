// Garmin Dashboard Widget — Scriptable (free on App Store)
// Paste into a new Scriptable script named GarminWidget

const DATA_URL = "https://csl16e.github.io/garmin/garmin/data.json"

const C = {
  bg:     new Color("#0d1117", 1),
  bg2:    new Color("#161b22", 1),
  teal:   new Color("#00c4b0", 1),
  muted:  new Color("#6b7280", 1),
  dim:    new Color("#374151", 1),
  text:   new Color("#f9fafb", 1),
  yellow: new Color("#f59e0b", 1),
  red:    new Color("#ef4444", 1),
  green:  new Color("#22c55e", 1),
  sep:    new Color("#ffffff", 0.07),
}

// Emojis via code points — avoids copy-paste corruption
function ep(n) { return String.fromCodePoint(n) }
const BOLT   = ep(0x26A1)
const MUSCLE = ep(0x1F4AA)
const FIRE   = ep(0x1F525)
const MOON   = ep(0x1F319)
const RUNNER = ep(0x1F3C3)
const STOP   = ep(0x1F6D1)
const LEAF   = ep(0x1F33F)
const SLEEP  = ep(0x1F634)

// ── helpers ───────────────────────────────────────────────────────────────────

function toMi(m) { return (m || 0) / 1609.34 }

function fmtPace(mps) {
  if (!mps) return "--"
  const mpmi = 26.8224 / mps
  const m = Math.floor(mpmi)
  const s = Math.round((mpmi - m) * 60)
  return m + ":" + String(s).padStart(2, "0")
}

function fmtMi(meters) { return toMi(meters).toFixed(2) + " mi" }

function fmtDur(secs) {
  if (!secs) return "--"
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? h + "h " + m + "m" : m + "m"
}

function rcColor(v) {
  if (v == null) return C.muted
  return v >= 75 ? C.green : v >= 50 ? C.teal : v >= 25 ? C.yellow : C.red
}

function scColor(v) {
  if (v == null) return C.muted
  return v >= 80 ? C.green : v >= 60 ? C.teal : v >= 40 ? C.yellow : C.red
}

function calcStreak(runs) {
  const dates = new Set(runs.map(r => (r.startTimeLocal || "").slice(0, 10)))
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

function runRec(runs, wellness) {
  const tr = (wellness[0] || {}).training_readiness
  const wmi = runs
    .filter(r => Date.now() - new Date(r.startTimeLocal) < 7 * 86400000)
    .reduce((s, r) => s + toMi(r.distance || 0), 0)
  const avgMps = runs.slice(0, 5).filter(r => r.averageSpeed)
    .reduce((s, r) => s + r.averageSpeed, 0) /
    (runs.slice(0, 5).filter(r => r.averageSpeed).length || 1)
  const daysSince = runs[0]
    ? (Date.now() - new Date(runs[0].startTimeLocal)) / 86400000 : 999

  if (tr != null && tr < 50)
    return { icon: STOP,   label: "Rest Day",      pace: null, note: "Readiness low -- recover today" }
  if (tr != null && tr >= 80 && wmi < 9 && daysSince >= 1)
    return { icon: FIRE,   label: "Tempo Run",     pace: avgMps ? avgMps * 1.08 : null, note: "High readiness -- push it" }
  if (wmi > 12)
    return { icon: LEAF,   label: "Easy Recovery", pace: avgMps ? avgMps * 0.88 : null, note: "High load -- back off" }
  return   { icon: RUNNER, label: "Base Run",       pace: avgMps ? avgMps * 0.88 : null, note: "Steady Zone 2 effort" }
}

function sleepTip(wellness) {
  const recent = wellness.filter(w => w.sleep_score != null).slice(0, 7)
  if (!recent.length) return "No sleep data yet"
  const avg = recent.reduce((s, w) => s + w.sleep_score, 0) / recent.length
  const durDays = wellness.filter(w => w.sleep_seconds).slice(0, 7)
  const avgHrs = durDays.length
    ? durDays.reduce((s, w) => s + w.sleep_seconds / 3600, 0) / durDays.length : 0
  if (avg < 60) return "Poor sleep lately -- aim for 10pm bedtime"
  if (avgHrs > 0 && avgHrs < 6.5) return "Averaging under 7h -- try 30 min earlier"
  if (avg >= 80) return "Great sleep streak -- keep the routine"
  return "Consistent bedtime improves your score"
}

// ── fetch ─────────────────────────────────────────────────────────────────────

async function fetchData() {
  const fm = FileManager.local()
  const cachePath = fm.joinPath(fm.temporaryDirectory(), "garmin_widget.json")
  try {
    const req = new Request(DATA_URL)
    req.timeoutInterval = 10
    const data = await req.loadJSON()
    fm.writeString(cachePath, JSON.stringify(data))
    return { data, fromCache: false }
  } catch (err) {
    if (fm.fileExists(cachePath)) {
      return { data: JSON.parse(fm.readString(cachePath)), fromCache: true }
    }
    return { data: null, error: String(err) }
  }
}

// ── widget ────────────────────────────────────────────────────────────────────

function addSep(widget) {
  widget.addSpacer(6)
  const row = widget.addStack()
  row.layoutHorizontally()
  row.backgroundColor = C.sep
  row.cornerRadius = 1
  const spacer = row.addSpacer()
  // force height via padding trick
  const pad = row.addText(" ")
  pad.textColor = new Color("#00000000")
  pad.font = Font.systemFont(1)
  widget.addSpacer(6)
}

function addLabel(widget, text) {
  const t = widget.addText(text)
  t.textColor = C.muted
  t.font = Font.boldSystemFont(8)
  return t
}

async function buildWidget(result) {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(14, 16, 12, 16)
  w.url = "https://csl16e.github.io/garmin"

  // Error state
  if (!result.data) {
    const t = w.addText("Could not load data")
    t.textColor = C.muted
    t.font = Font.systemFont(12)
    if (result.error) {
      w.addSpacer(4)
      const e = w.addText(result.error.slice(0, 80))
      e.textColor = C.red
      e.font = Font.systemFont(9)
      e.lineLimit = 3
    }
    return w
  }

  const { data } = result
  const wellness = (data.wellness || []).sort((a, b) => b.date.localeCompare(a.date))
  const runs = (data.activities || [])
    .filter(a => {
      const k = a.activityType?.typeKey || ""
      return k === "running" || k === "treadmill_running"
    })
    .sort((a, b) => b.startTimeLocal.localeCompare(a.startTimeLocal))

  const todayW  = wellness[0] || {}
  const lastRun = runs[0]
  const streak  = calcStreak(runs)
  const sleepDay = wellness.find(w => w.sleep_score != null) || {}
  const rec     = runRec(runs, wellness)
  const tip     = sleepTip(wellness)
  const tr      = todayW.training_readiness
  const ss      = sleepDay.sleep_score
  const family  = config.widgetFamily || "large"

  // ── HEADER
  const hdr = w.addStack()
  hdr.layoutHorizontally()
  hdr.centerAlignContent()
  const logo = hdr.addText(BOLT + " Garmin")
  logo.textColor = C.teal
  logo.font = Font.boldSystemFont(13)
  hdr.addSpacer()
  const dateStr = lastRun
    ? new Date(lastRun.startTimeLocal).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : ""
  const dateLbl = hdr.addText(dateStr)
  dateLbl.textColor = C.muted
  dateLbl.font = Font.systemFont(10)

  w.addSpacer(10)

  // ── STATS ROW: readiness | streak | sleep
  const stats = w.addStack()
  stats.layoutHorizontally()

  function addStat(parent, icon, value, label, color) {
    const col = parent.addStack()
    col.layoutVertically()
    col.centerAlignContent()

    const valRow = col.addStack()
    valRow.layoutHorizontally()
    valRow.centerAlignContent()
    const icoT = valRow.addText(icon)
    icoT.textColor = color
    icoT.font = Font.systemFont(11)
    valRow.addSpacer(2)
    const valT = valRow.addText(String(value ?? "--"))
    valT.textColor = color
    valT.font = Font.boldSystemFont(22)

    col.addSpacer(2)
    const lblT = col.addText(label)
    lblT.textColor = C.muted
    lblT.font = Font.systemFont(9)
    lblT.centerAlignText()
  }

  addStat(stats, MUSCLE, tr,     "Readiness",   rcColor(tr))
  stats.addSpacer()
  addStat(stats, FIRE,   streak, "Day Streak",  C.yellow)
  stats.addSpacer()
  addStat(stats, SLEEP,  ss,     "Sleep Score", scColor(ss))

  w.addSpacer(10)
  addSep(w)

  // ── LAST RUN
  addLabel(w, "LAST RUN")
  w.addSpacer(4)

  if (lastRun) {
    const r1 = w.addStack()
    r1.layoutHorizontally()
    r1.centerAlignContent()
    const rn = r1.addText(lastRun.activityName || "Run")
    rn.textColor = C.text
    rn.font = Font.mediumSystemFont(13)
    rn.lineLimit = 1
    r1.addSpacer()
    const rd = r1.addText(fmtMi(lastRun.distance))
    rd.textColor = C.teal
    rd.font = Font.boldSystemFont(15)

    w.addSpacer(3)
    const r2 = w.addStack()
    r2.layoutHorizontally()
    r2.spacing = 8
    const dStr = new Date(lastRun.startTimeLocal)
      .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    ;[dStr, fmtPace(lastRun.averageSpeed) + "/mi", fmtDur(lastRun.duration)].forEach(txt => {
      const t = r2.addText(txt)
      t.textColor = C.muted
      t.font = Font.systemFont(10)
    })
  } else {
    const t = w.addText("No runs found")
    t.textColor = C.muted
    t.font = Font.systemFont(11)
  }

  if (family === "small") {
    w.addSpacer()
    return w
  }

  // ── TODAY'S RUN
  addSep(w)
  addLabel(w, "TODAY'S RUN")
  w.addSpacer(4)

  const recRow = w.addStack()
  recRow.layoutHorizontally()
  recRow.centerAlignContent()
  const recType = recRow.addText(rec.icon + " " + rec.label)
  recType.textColor = C.text
  recType.font = Font.boldSystemFont(13)
  recRow.addSpacer()
  if (rec.pace) {
    const recPace = recRow.addText(fmtPace(rec.pace) + "/mi")
    recPace.textColor = C.teal
    recPace.font = Font.mediumSystemFont(12)
  }
  w.addSpacer(2)
  const recNote = w.addText(rec.note)
  recNote.textColor = C.muted
  recNote.font = Font.systemFont(10)

  if (family === "medium") {
    w.addSpacer()
    return w
  }

  // ── SLEEP TIP (large only)
  addSep(w)
  addLabel(w, "SLEEP TIP")
  w.addSpacer(4)

  if (sleepDay.sleep_seconds) {
    const hrs = (sleepDay.sleep_seconds / 3600).toFixed(1)
    const sleepRow = w.addStack()
    sleepRow.layoutHorizontally()
    sleepRow.centerAlignContent()
    const moonT = sleepRow.addText(MOON + " " + hrs + "h last night")
    moonT.textColor = scColor(ss)
    moonT.font = Font.mediumSystemFont(13)
  }
  w.addSpacer(3)
  const tipT = w.addText(tip)
  tipT.textColor = C.muted
  tipT.font = Font.systemFont(10)
  tipT.lineLimit = 2

  w.addSpacer()

  // ── FOOTER
  const foot = w.addStack()
  foot.layoutHorizontally()
  foot.centerAlignContent()
  const wmi = runs
    .filter(r => Date.now() - new Date(r.startTimeLocal) < 7 * 86400000)
    .reduce((s, r) => s + toMi(r.distance || 0), 0)
  const wkT = foot.addText("This week: " + wmi.toFixed(1) + " mi")
  wkT.textColor = C.muted
  wkT.font = Font.systemFont(9)
  foot.addSpacer()
  const now = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  const upT = foot.addText("Updated " + now)
  upT.textColor = new Color("#ffffff", 0.15)
  upT.font = Font.systemFont(9)

  return w
}

// ── run ───────────────────────────────────────────────────────────────────────
// Wrap in async IIFE — required for home screen widgets in Scriptable

async function run() {
  try {
    const result = await fetchData()
    const widget = await buildWidget(result)
    if (config.runInWidget) {
      Script.setWidget(widget)
    } else {
      await widget.presentLarge()
    }
  } catch (err) {
    // Show error so it's never just white
    const w = new ListWidget()
    w.backgroundColor = new Color("#0d1117", 1)
    w.setPadding(14, 16, 14, 16)
    const t1 = w.addText("Script error")
    t1.textColor = new Color("#ef4444", 1)
    t1.font = Font.boldSystemFont(13)
    w.addSpacer(6)
    const t2 = w.addText(String(err))
    t2.textColor = new Color("#6b7280", 1)
    t2.font = Font.systemFont(10)
    t2.lineLimit = 5
    if (config.runInWidget) Script.setWidget(w)
    else await w.presentLarge()
  }
  Script.complete()
}

run()
