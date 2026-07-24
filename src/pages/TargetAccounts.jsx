import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import accounts from '../data/target-accounts.json'
import competitors from '../data/competitors.json'
import battlecards from '../data/battlecards.json'
import meta from '../data/meta.json'
import DataTable from '../components/DataTable.jsx'
import FilterBar from '../components/FilterBar.jsx'
import DataBadge from '../components/DataBadge.jsx'
import { uniqueValues, bandForRevenue } from '../lib/filters'
import { computeFitScore, scoreTier, scoreTierLabel, FACTOR_KEYS } from '../lib/scoring'

const competitorName = (id) => competitors.find((c) => c.id === id)?.name || id
const battlecardFor = (id) => battlecards.find((b) => b.competitorId === id)

function formatRevenue(revenue) {
  if (revenue == null) return '—'
  if (revenue >= 1000) return `$${(revenue / 1000).toFixed(1)}B`
  return `$${revenue}M`
}

// Pre-compute derived fields once.
const enriched = accounts.map((a) => ({
  ...a,
  sizeBand: a.revenue != null ? bandForRevenue(a.revenue, meta.sizeBands) : 'Unknown',
  fitScore: computeFitScore(a),
  vendorLabel: a.currentScpVendor ? competitorName(a.currentScpVendor) : 'No known vendor',
}))

const FIT_RANGES = [
  { label: 'Hot (75+)', test: (s) => s >= 75 },
  { label: 'Warm (55–74)', test: (s) => s >= 55 && s < 75 },
  { label: 'Cool (<55)', test: (s) => s < 55 },
]

export default function TargetAccounts() {
  const [filters, setFilters] = useState({
    search: '',
    region: '',
    erp: '',
    sizeBand: '',
    vendor: '',
    fit: '',
  })
  const [selected, setSelected] = useState(null)

  const regions = useMemo(() => uniqueValues(enriched, 'region'), [])
  const erps = useMemo(() => uniqueValues(enriched, 'erp'), [])
  const sizeBands = useMemo(() => meta.sizeBands.map((b) => b.label), [])
  const vendors = useMemo(() => uniqueValues(enriched, 'vendorLabel'), [])

  const rows = useMemo(() => {
    return enriched.filter((a) => {
      if (filters.search && !a.name.toLowerCase().includes(filters.search.toLowerCase()))
        return false
      if (filters.region && a.region !== filters.region) return false
      if (filters.erp && a.erp !== filters.erp) return false
      if (filters.sizeBand && a.sizeBand !== filters.sizeBand) return false
      if (filters.vendor && a.vendorLabel !== filters.vendor) return false
      if (filters.fit) {
        const range = FIT_RANGES.find((r) => r.label === filters.fit)
        if (range && !range.test(a.fitScore)) return false
      }
      return true
    })
  }, [filters])

  const fields = [
    { key: 'search', label: 'Search account', type: 'search', placeholder: 'Company…' },
    { key: 'region', label: 'Region', type: 'select', options: regions },
    { key: 'erp', label: 'ERP', type: 'select', options: erps },
    { key: 'sizeBand', label: 'Size', type: 'select', options: sizeBands },
    { key: 'vendor', label: 'Current SCP vendor', type: 'select', options: vendors },
    { key: 'fit', label: 'Fit', type: 'select', options: FIT_RANGES.map((r) => r.label) },
  ]

  const columns = [
    { key: 'name', label: 'Company', accessor: (r) => r.name },
    { key: 'industry', label: 'Industry' },
    { key: 'region', label: 'Region' },
    { key: 'country', label: 'Country' },
    {
      key: 'revenue',
      label: 'Revenue',
      sortAccessor: (r) => r.revenue ?? -1,
      accessor: (r) => formatRevenue(r.revenue),
    },
    {
      key: 'employees',
      label: 'Employees',
      sortAccessor: (r) => r.employees ?? -1,
      accessor: (r) => (r.employees != null ? r.employees.toLocaleString() : '—'),
    },
    { key: 'erp', label: 'ERP' },
    {
      key: 'vendorLabel',
      label: 'Current Vendor',
      render: (r) =>
        r.currentScpVendor ? (
          <span className="badge cat">{r.vendorLabel}</span>
        ) : (
          <span className="muted">No known vendor</span>
        ),
    },
    {
      key: 'fitScore',
      label: 'Fit Score',
      sortAccessor: (r) => r.fitScore,
      render: (r) => <span className={`score ${scoreTier(r.fitScore)}`}>{r.fitScore}</span>,
    },
  ]

  function update(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
  }
  function reset() {
    setFilters({ search: '', region: '', erp: '', sizeBand: '', vendor: '', fit: '' })
  }

  return (
    <div>
      <div className="page-head">
        <div className="eyebrow">Prospecting Tool</div>
        <h1>Target Accounts</h1>
        <p>
          Filter and rank companies by fit. The fit score is computed from platform fit,
          greenfield opportunity, account size, and regional priority — see{' '}
          <Link to="/methodology">Fit Scoring</Link>. Click a row for talking points and the
          right battlecard.
        </p>
      </div>

      <div className="banner warn">
        This account list is an illustrative starting point, not a verified prospecting list.
        Revenue, employee counts, ERP, and current-vendor fields are directional estimates for
        prioritization — confirm each before using in outreach or a deal. Replace or extend this
        file with your own vetted target list in <code>src/data/target-accounts.json</code>.
      </div>

      <FilterBar fields={fields} values={filters} onChange={update} onReset={reset} />
      <div className="result-count">
        Showing {rows.length} of {enriched.length} accounts
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        onRowClick={setSelected}
        initialSort={{ key: 'fitScore', dir: 'desc' }}
      />

      {selected && <AccountDetail account={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function AccountDetail({ account, onClose }) {
  const bc = account.currentScpVendor ? battlecardFor(account.currentScpVendor) : null
  return (
    <div className="card" style={{ marginTop: 22 }}>
      <div className="spread">
        <h2 style={{ marginBottom: 0 }}>
          {account.name} <DataBadge confidence={account.sourceConfidence} />
        </h2>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="detail-grid" style={{ marginTop: 14 }}>
        <div>
          <dl className="kv">
            <dt>Industry</dt>
            <dd>{account.industry}</dd>
            <dt>Region / Country</dt>
            <dd>
              {account.region} · {account.country}
            </dd>
            <dt>Revenue</dt>
            <dd>
              {account.revenue != null
                ? `${formatRevenue(account.revenue)} (${account.sizeBand})`
                : 'Not publicly reported'}
            </dd>
            <dt>Employees</dt>
            <dd>{account.employees != null ? account.employees.toLocaleString() : '—'}</dd>
            <dt>Plants / facilities</dt>
            <dd>{account.plants != null ? account.plants.toLocaleString() : '—'}</dd>
            <dt>ERP</dt>
            <dd>{account.erp}</dd>
            <dt>Current SCP vendor</dt>
            <dd>{account.vendorLabel}</dd>
            <dt>Source</dt>
            <dd>
              {account.source ? (
                <a href={account.source} target="_blank" rel="noreferrer">
                  Company facts →
                </a>
              ) : (
                '—'
              )}
            </dd>
          </dl>
          {account.notes && (
            <p style={{ marginTop: 14 }}>
              <strong>Intel:</strong> {account.notes}
            </p>
          )}
          <h3 style={{ marginTop: 16 }}>Suggested talking points</h3>
          <ul className="list-clean">
            {account.currentScpVendor ? (
              <li>
                Displacement play — they may already run <strong>{account.vendorLabel}</strong>.
                Lead with the relevant battlecard and a focused pilot on a decision the incumbent
                handles poorly today.
              </li>
            ) : (
              <li>
                No known incumbent — likely greenfield (unverified). Lead with Salesforce-native
                commercial visibility and faster time-to-value than a legacy platform buildout.
              </li>
            )}
            {account.erp === 'SAP' ? (
              <li>SAP shop — position ketteQ as an overlay on the existing SAP landscape, not a rip-and-replace.</li>
            ) : (
              <li>
                {account.erp} shop — lead with the integration roadmap for their ERP; bring
                relevant references.
              </li>
            )}
            <li>
              Scale: ~{account.employees?.toLocaleString() || 'many'} employees across{' '}
              {account.plants ?? 'multiple'} plants/facilities — model ROI on documentation time
              and inventory carrying costs saved across the network.
            </li>
          </ul>
        </div>
        <div>
          <div className="card" style={{ background: 'var(--bg)' }}>
            <div className="eyebrow">Fit Score</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 12px' }}>
              <span className={`score ${scoreTier(account.fitScore)}`} style={{ fontSize: 16 }}>
                {account.fitScore}
              </span>
              <strong>{scoreTierLabel(account.fitScore)}</strong>
            </div>
            <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
              {FACTOR_KEYS.map((k) => (
                <FactorRow key={k} label={meta.factorLabels[k]} value={account.fitFactors[k]} />
              ))}
            </dl>
          </div>
          {bc && (
            <p style={{ marginTop: 14 }}>
              <Link className="btn primary" to={`/battlecards/${bc.competitorId}`}>
                Open {account.vendorLabel} battlecard →
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function FactorRow({ label, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}/5</dd>
    </>
  )
}
