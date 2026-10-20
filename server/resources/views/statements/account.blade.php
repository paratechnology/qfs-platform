@php($text = fn ($value) => \App\Support\LocalizedText::translate($value))
<!doctype html>
<html lang="{{ app()->getLocale() }}" dir="{{ in_array(app()->getLocale(), ['ar', 'ur']) ? 'rtl' : 'ltr' }}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QFS — {{ $text('Account statement') }}</title>
<style>
body{font:13px/1.6 system-ui,sans-serif;color:#18211e;margin:40px auto;padding:0 24px;max-width:1100px}h1{font-size:26px;margin-bottom:6px}h2{font-size:17px;margin-top:32px}p{color:#52605a}table{border-collapse:collapse;width:100%;font-size:11px;overflow-wrap:anywhere}th,td{padding:10px 8px;border-bottom:1px solid #dce2df;text-align:start;vertical-align:top}th{font-weight:600}button{padding:12px 20px;border:0;border-radius:8px;background:#182d22;color:white;cursor:pointer}code{font-size:10px}small{display:block;color:#52605a}.scroll{overflow:auto}@media print{body{margin:0;max-width:none;padding:0;font-size:11px}button{display:none}thead{display:table-header-group}tr{break-inside:avoid}.scroll{overflow:visible}h2{break-after:avoid}}@page{size:A4 landscape;margin:14mm}
</style></head><body>
<button onclick="window.print()">{{ $text('Print / save as PDF') }}</button>
<h1>QFS · {{ $text('Account statement') }}</h1>
<strong>{{ $statement['name'] }}</strong><small>{{ $statement['email'] }}</small>
<p>{{ $statement['from'] }} — {{ $statement['to'] }} · UTC<br>{{ $text('Generated at') }} {{ $statement['generatedAt'] }}</p>
<h2>{{ $text('Current account snapshot') }}</h2>
<p>{{ $text('These balances and investment records are current at generation time. They are not the opening or closing balances for the selected period.') }}</p>
<table><thead><tr><th>{{ $text('Asset / network') }}</th><th>{{ $text('Total') }}</th><th>{{ $text('Reserved') }}</th></tr></thead><tbody>
<tr><td>USD</td><td>{{ \App\Support\Qfs::money($statement['balanceCents']) }}</td><td>{{ \App\Support\Qfs::money($statement['balanceCents'] - $statement['availableCents']) }}</td></tr>
@foreach($statement['holdings'] as $holding)<tr><td>{{ $holding['assetKey'] }}</td><td>{{ $holding['quantity'] }}</td><td>{{ $holding['reserved'] }}</td></tr>@endforeach
</tbody></table>
<h2>{{ $text('Activity in selected period') }} · {{ $statement['transactionCount'] }}</h2>
<p>{{ $text('Amounts show recorded activity. Investment allocations and principal releases are internal movements; do not add all rows as income. Crypto quantities and USD amounts are separate units.') }}</p>
<div class="scroll"><table><thead><tr><th>{{ $text('Date') }} · UTC</th><th>{{ $text('Reference') }}</th><th>{{ $text('Type') }}</th><th>{{ $text('Status') }}</th><th>{{ $text('Amount') }}</th><th>{{ $text('Recorded USD amount') }}</th><th>{{ $text('Fee') }} · USD</th></tr></thead><tbody>
@forelse($statement['transactions'] as $row)<tr><td>{{ $row['createdAt'] }}</td><td><code>{{ $row['reference'] }}</code></td><td>{{ $text($row['type']) }}<small>{{ $row['assetKey'] }}</small></td><td>{{ $text($row['status']) }}</td><td>{{ $row['displayAmount'] }}</td><td>{{ \App\Support\Qfs::money($row['amountCents']) }}</td><td>{{ \App\Support\Qfs::money($row['feeCents']) }}</td></tr>@empty<tr><td colspan="7">{{ $text('No activity in this period.') }}</td></tr>@endforelse
</tbody></table></div>
<h2>{{ $text('Current investment records') }}</h2>
<div class="scroll"><table><thead><tr><th>{{ $text('Reference') }}</th><th>{{ $text('Status') }}</th><th>{{ $text('Principal') }}</th><th>{{ $text('Monthly rate') }}</th><th>{{ $text('Term') }}</th><th>{{ $text('Payout interval') }}</th><th>{{ $text('Profit paid') }}</th></tr></thead><tbody>
@forelse($statement['investments'] as $row)<tr><td><code>{{ $row['id'] }}</code><small>{{ $row['startDate'] }} — {{ $row['endDate'] }}</small></td><td>{{ $text($row['status']) }}</td><td>{{ \App\Support\Qfs::money($row['amountCents']) }}</td><td>{{ \App\Support\Qfs::number($row['monthlyRoiBps']/100, 2) }}%</td><td>{{ $row['termMonths'] }} {{ $text('months') }}</td><td>{{ $text($row['payoutInterval']) }}</td><td>{{ \App\Support\Qfs::money($row['paidOutCents']) }}</td></tr>@empty<tr><td colspan="7">{{ $text('No investments yet.') }}</td></tr>@endforelse
</tbody></table></div></body></html>
