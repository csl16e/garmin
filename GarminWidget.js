// GarminWidget — paste into Scriptable

async function run() {
  const w = new ListWidget()
  w.backgroundColor = new Color("#0d1117")
  w.setPadding(16, 16, 16, 16)

  try {
    // Step 1: basic text
    const title = w.addText("Garmin Widget")
    title.textColor = new Color("#00c4b0")
    title.font = Font.boldSystemFont(16)

    w.addSpacer(8)

    // Step 2: fetch data
    const req = new Request("https://csl16e.github.io/garmin/garmin/data.json")
    req.timeoutInterval = 10
    const data = await req.loadJSON()

    const runs = (data.activities || [])
      .filter(a => (a.activityType?.typeKey || "").includes("running"))
      .sort((a, b) => b.startTimeLocal.localeCompare(a.startTimeLocal))

    const wellness = (data.wellness || [])
      .sort((a, b) => b.date.localeCompare(a.date))

    const last = runs[0]
    const tr = wellness[0]?.training_readiness
    const ss = (wellness.find(w => w.sleep_score) || {}).sleep_score

    // Readiness
    const r1 = w.addText("Readiness: " + (tr ?? "--"))
    r1.textColor = new Color("#f9fafb")
    r1.font = Font.systemFont(13)

    w.addSpacer(4)

    // Sleep
    const r2 = w.addText("Sleep Score: " + (ss ?? "--"))
    r2.textColor = new Color("#f9fafb")
    r2.font = Font.systemFont(13)

    w.addSpacer(4)

    // Last run
    if (last) {
      const mi = ((last.distance || 0) / 1609.34).toFixed(2)
      const r3 = w.addText("Last run: " + mi + " mi")
      r3.textColor = new Color("#00c4b0")
      r3.font = Font.systemFont(13)

      w.addSpacer(2)
      const d = new Date(last.startTimeLocal).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric"
      })
      const r4 = w.addText(d)
      r4.textColor = new Color("#6b7280")
      r4.font = Font.systemFont(11)
    }

  } catch(err) {
    const errT = w.addText("Error: " + String(err).slice(0, 100))
    errT.textColor = new Color("#ef4444")
    errT.font = Font.systemFont(10)
    errT.lineLimit = 4
  }

  if (config.runInWidget) {
    Script.setWidget(w)
  } else {
    await w.presentLarge()
  }

  Script.complete()
}

run()
