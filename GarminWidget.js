// Garmin Dashboard Widget for Scriptable
// Install Scriptable (free) from the App Store, paste this script, then
// long-press home screen > + > Scriptable > pick "GarminWidget"

const DATA_URL = "https://csl16e.github.io/garmin/garmin/data.json"
const CACHE_KEY = "garmin_widget_cache"

// Colors
const TEAL   = new Color("#00c4b0")
const BG     = new Color("#0d1117")
const MUTED  = new Color("#6b7280")
const TEXT   = Color.white()
const YELLOW = new Color("#f59e0b")
const RED    = new Color("#ef4444")
const GREEN  = new Color("#22c55e")

// Emojis as code points so copy-paste never corrupts them
function e(cp) { return String.fromCodePoint(cp) }
const ICO = {
  bolt:   e(0x26A1),   // lightning
  muscle: e(0x1F4AA), // flexed arm
  fire:   e(0x1F525), // fire
  sleep:  e(0x1F634), // sleeping face
  run:    e(0x1F3C3), // runner
  stop:   e(0x1F6D1), // stop sign
  leaf:   e(0x1F33F), // leaf
  moon:   e(0x1F319), // crescent moon
  warn:   e(0x26A0),  // warning
  dash:   "-"
}

// ── helpers ──────────────────────────────────────────────────────────────────

function mi(m) { return (m || 0) / 1609.34 }

function fmtPace(mps) {
  if (!mps || mps <= 0) return "--"
  const mpmi = 26.8224 / mps
  const m = Math.floor(mpmi)
  const s = Math.round((mpmi - m) * 60)
  return m + ":" + String(s).padStart(2, "0")
}

function fmtMi(meters) {
  return mi(meters).toFixed(2) + " mi"
}

function fmtDur(secs) {
  if (!secs) return "--"
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? h + "h " + m + "m" : m + "m"
}

function readinessColor(v) {
  if (v == null) return MUTED
  return v >= 75 ? GREEN : v >= 50 ? TEAL : v >= 25 ? YELLOW : RED
}

function sleepColor(v) {
  if (v == null) return MUTED
  return v >= 80 ? GREEN : v >= 60 ? TEAL : v >= 40 ? YELLOW : RED
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

function nextRunRec(runs, wellness) {
  const today = wellness[0] || {}
  const tr = today.training_readiness
  const last5 = runs.slice(0, 5)
  const avgMps = last5.filter(r => r.averageSpeed)
    .reduce((s, r) => s + r.averageSpeed, 0) /
    (last5.filter(r => r.averageSpeed).length || 1)
  const wmi = runs
    .filter(r => (Date.now() - new Date(r.startTimeLocal)) < 7 * 86400000)
    .reduce((s, r) => s + mi(r.distance || 0), 0)
  const daysSince = runs[0]
    ? (Date.now() - new Date(runs[0].startTimeLocal)) / 86400000 : 999
  const ep = avgMps ? avgMps * 0.88 : null
  const tp = avgMps ? avgMps * 1.08 : null

  if (tr != null && tr < 50)
    return { icon: ICO.stop, type: "Rest Day",      pace: null, note: "Readiness low -- recover today" }
  if (tr != null && tr >= 80 && wmi < 9 && daysSince >= 1)
    return { icon: ICO.fire, type: "Tempo Run",     pace: tp,   note: "High readiness -- push hard" }
  if (wmi > 12)
    return { icon: ICO.leaf, type: "Easy Recovery", pace: ep,   note: "High weekly load -- back off" }
  return   { icon: ICO.run,  type: "Base Run",      pace: ep,   note: "Steady Zone 2 effort" }
}

function sleepTip(wellness) {
  const recent = wellness.filter(w => w.sleep_score != null).slice(0, 7)
  if (!recent.length) return null
  const avgScore = recent.reduce((s, w) => s + w.sleep_score, 0) / recent.length
  const durDays = wellness.filter(w => w.sleep_seconds).slice(0, 7)
  const avgHrs = durDays.length
    ? durDays.reduce((s, w) => s + w.sleep_seconds / 3600, 0) / durDays.length
    : 0
  if (avgScore < 60) return "Poor sleep lately -- aim for 10pm bedtime tonight"
  if (avgHrs > 0 && avgHrs < 6.5) return "Averaging under 7h -- try getting to bed 30 min earlier"
  if (avgScore >= 80) return "Great sleep streak -- keep the same schedule"
  return "Consistent bedtime improves score. Avoid screens after 10pm"
}

// ── fetch ─────────────────────────────────────────────────────────────────────

async function fetchData() {
  const fm = FileManager.local()
  const cachePath = fm.joinPath(fm.temporaryDirectory(), CACHE_KEY + ".json")
  try {
    const req = new Request(DATA_URL)
    req.timeoutInterval = 8
    const data = await req.loadJSON()
    fm.writeString(cachePath, JSON.stringify(data))
    return data
  } catch(err) {
    if (fm.fileExists(cachePath)) return JSON.parse(fm.readString(cachePath))
    return null
  }
}

// ── build widget ──────────────────────────────────────────────────────────────

async function buildWidget(data) {
  const w = new ListWidget()
  w.backgroundColor = BG
  w.setPadding(14, 16, 14, 16)
  w.url = "https://csl16e.github.io/garmin"

  if (!data) {
    const t = w.addText(ICO.warn + " Could not load data")
    t.textColor = MUTED
    t.font = Font.mediumSystemFont(13)
    return w
  }

  const wellness = (data.wellness || []).sort((a, b) => b.date.localeCompare(a.date))
  const runs = (data.activities || [])
    .filter(a => {
      const key = a.activityType?.typeKey || ""
      return key === "running" || key === "treadmill_running"
    })
    .sort((a, b) => b.startTimeLocal.localeCompare(a.startTimeLocal))

  const today    = wellness[0] || {}
  const lastRun  = runs[0]
  const streak   = calcStreak(runs)
  const sleepDay = wellness.find(w => w.sleep_score != null) || {}
  const rec      = nextRunRec(runs, wellness)
  const tip      = sleepTip(wellness)
  const family   = config.widgetFamily || "large"

  // Header
  const hdr = w.addStack()
  hdr.layoutHorizontally()
  hdr.centerAlignContent()
  const logoTxt = hdr.addText(ICO.bolt + " Garmin")
  logoTxt.textColor = TEAL
  logoTxt.font = Font.boldSystemFont(13)
  hdr.addSpacer()
  const syncDate = data.activities?.length
    ? new Date(data.activities[0].startTimeLocal)
        .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : ""
  const syncLbl = hdr.addText(syncDate)
  syncLbl.textColor = MUTED
  syncLbl.font = Font.systemFont(10)

  w.addSpacer(8)

  // Stat block helper
  function statBlock(parent, icon, value, label, color) {
    const col = parent.addStack()
    col.layoutVertically()
    col.centerAlignContent()
    const top = col.addStack()
    top.layoutHorizontally()
    top.centerAlignContent()
    const ico = top.addText(icon + " ")
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

  // Top stats row
  const statsRow = w.addStack()
  statsRow.layoutHorizontally()
  const tr = today.training_readiness
  const ss = sleepDay.sleep_score
  statBlock(statsRow, ICO.muscle, tr ?? "--", "Readiness",   readinessColor(tr))
  statsRow.addSpacer()
  statBlock(statsRow, ICO.fire,   streak || 0, streak === 1 ? "day streak" : "day streak", YELLOW)
  statsRow.addSpacer()
  statBlock(statsRow, ICO.sleep,  ss ?? "--",  "Sleep Score", sleepColor(ss))

  w.addSpacer(10)

  // Thin divider
  function divider() {
    const d = w.addStack()
    d.backgroundColor = new Color("#ffffff11")
    d.size = new Size(0, 1)
    w.addSpacer(8)
  }
  divider()

  // Last Run
  const lrHdr = w.addText("LAST RUN")
  lrHdr.textColor = MUTED
  lrHdr.font = Font.boldSystemFont(8)
  w.addSpacer(4)

  if (lastRun) {
    const row1 = w.addStack()
    row1.layoutHorizontally()
    row1.centerAlignContent()
    const rName = row1.addText(lastRun.activityName || "Run")
    rName.textColor = TEXT
    rName.font = Font.mediumSystemFont(13)
    rName.lineLimit = 1
    row1.addSpacer()
    const rDist = row1.addText(fmtMi(lastRun.distance))
    rDist.textColor = TEAL
    rDist.font = Font.boldSystemFont(15)

    w.addSpacer(3)
    const row2 = w.addStack()
    row2.layoutHorizontally()
    row2.spacing = 8
    const dateStr = new Date(lastRun.startTimeLocal).toLocaleDateString("en-US",
      { weekday: "short", month: "short", day: "numeric" })
    ;[dateStr, fmtPace(lastRun.averageSpeed) + "/mi", fmtDur(lastRun.duration)].forEach(item => {
      const t = row2.addText(item)
      t.textColor = MUTED
      t.font = Font.systemFont(10)
    })
  } else {
    const noRun = w.addText("No recent runs")
    noRun.textColor = MUTED
    noRun.font = Font.systemFont(11)
  }

  // Large widget extras
  if (family === "large" || family === "extraLarge") {
    w.addSpacer(10)
    divider()

    // Today's run recommendation
    const recHdr = w.addText("TODAY'S RUN")
    recHdr.textColor = MUTED
    recHdr.font = Font.boldSystemFont(8)
    w.addSpacer(4)

    const recRow = w.addStack()
    recRow.layoutHorizontally()
    recRow.centerAlignContent()
    const recType = recRow.addText(rec.icon + " " + rec.type)
    recType.textColor = TEXT
    recType.font = Font.boldSystemFont(13)
    recRow.addSpacer()
    if (rec.pace) {
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

    if (sleepDay.sleep_seconds) {
      const hrs = (sleepDay.sleep_seconds / 3600).toFixed(1)
      const hrsRow = w.addStack()
      hrsRow.layoutHorizontally()
      const hrsIcon = hrsRow.addText(ICO.moon + " ")
      hrsIcon.textColor = sleepColor(ss)
      hrsIcon.font = Font.mediumSystemFont(12)
      const hrsLbl = hrsRow.addText(hrs + "h last night")
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

  // Footer
  const footer = w.addStack()
  footer.layoutHorizontally()
  footer.centerAlignContent()
  const wmi = runs
    .filter(r => (Date.now() - new Date(r.startTimeLocal)) < 7 * 86400000)
    .reduce((s, r) => s + mi(r.distance || 0), 0)
  const wkLbl = footer.addText("This week: " + wmi.toFixed(1) + " mi")
  wkLbl.textColor = MUTED
  wkLbl.font = Font.systemFont(9)
  footer.addSpacer()
  const now = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  const updLbl = footer.addText("Updated " + now)
  updLbl.textColor = new Color("#ffffff22")
  updLbl.font = Font.systemFont(9)

  return w
}

// ── run ───────────────────────────────────────────────────────────────────────

const data = await fetchData()
const widget = await buildWidget(data)

if (config.runInWidget) {
  Script.setWidget(widget)
} else {
  widget.presentLarge()
}
Script.complete()
