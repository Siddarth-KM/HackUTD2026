// Builds the two small arrival files the "accept all" and "weekend drop" specs need:
//   arrivals_trimmed.jsonl  the sample week WITHOUT Garza's photo ID and EIN letter (so Garza has two issues blocking Intake)
//   garza_drop.jsonl        just those two files, arriving Wed 12:00 (the "weekend drop")
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const TMP = path.join(here, '.tmp')
const MISSING = ['Garza Family Pharmacy/02_Guarantor_ID.pdf', 'Garza Family Pharmacy/04_EIN_Letter.pdf']

export default async function globalSetup() {
  const src = path.resolve(here, '..', '..', 'data', 'participant', 'sim', 'arrivals.jsonl')
  const rows = fs.readFileSync(src, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  fs.mkdirSync(TMP, { recursive: true })
  const trimmed = rows.filter((r) => !MISSING.includes(r.path))
  const drop = MISSING.map((p) => ({ path: p, arrive_at: '2026-11-04T12:00-06:00' }))
  if (trimmed.length !== rows.length - 2) throw new Error('Garza files not found in arrivals.jsonl')
  fs.writeFileSync(path.join(TMP, 'arrivals_trimmed.jsonl'), trimmed.map((r) => JSON.stringify(r)).join('\n') + '\n')
  fs.writeFileSync(path.join(TMP, 'garza_drop.jsonl'), drop.map((r) => JSON.stringify(r)).join('\n') + '\n')
}
