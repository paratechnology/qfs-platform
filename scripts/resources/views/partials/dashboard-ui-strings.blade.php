@php
    $uiKeys = [
        'Add Funds', 'Make New withdrawal', 'Swap crypto', 'Manage Cards', 'Start New Investment', 'Invest',
        'Select Plan', 'Investment Amount', 'Start Investment', 'Starting investment…', 'Investment started',
        'Your investment is active. Profit accrues per the plan terms.', 'No investment plans are available right now.',
        'You have no active investments.', 'Choose a plan and invest from your available USD balance. Profit accrues per the plan terms.',
        'Loan Application', 'Notifications', 'Dialog', 'My Profile', 'Apply for Loan',
        'Loan Amount', 'Loan Type', 'Loan Repayment Period', 'Your Occupation', 'Enter your occupation',
        'Preferred payout currency', 'Submitting application…', 'Fill in the loan amount and your occupation',
        'Loan application submitted. Status: Pending review.', 'Done', 'Close menu', 'Available balance',
        'USD value', 'Add Fund', 'Logout', 'Account', 'Manage', 'My Cards', 'Secure Wallet',
        'Dashboard', 'Active Investments', 'Transactions', 'Account statements', 'Withdrawals', 'Loans',
        'Customers Reviews', 'Reviews', 'average', 'Illustrative reviews', 'No approved reviews yet.',
        'Identity Verification', 'Account settings', 'Search transactions, plans…', 'Searching…',
        'No matching results', 'View Public Site', 'Manage Wallet', 'Name', 'Email', 'Country', 'Member since',
        'You have no notifications yet.', 'Mark all as read', 'Marking as read…', 'All notifications marked as read', 'Close',
        'Deposit submitted — awaiting review', 'Deposit request created — send crypto to the address below',
        'Submit deposit request', 'Submitting deposit…', 'You can submit without a transaction hash. Add a hash if you already sent the transfer.',
        'Enter a valid amount', 'Copy', 'Copied', 'Pay to', 'Your deposit reference',
        'Deposit request submitted', 'Pending review', 'Submit Deposit Request', 'Submitting deposit…', 'Get deposit instructions',
        'Preparing deposit…', 'Continue a deposit', 'Pending review', 'Pending', 'Back to deposits', 'Download QR code',
        'Pay with connected wallet', 'Confirm in your wallet…', 'Submit transfer for review', 'Saving transfer…',
        'Deposit confirmed', 'Deposit rejected', 'Payment cancelled in your wallet.',
        'Send only {symbol} on {network} to this address.',
    ];
    $uiPack = \App\Support\UiStrings::map($uiKeys);
@endphp
<script>
window.__QFS_UI = @json($uiPack);
window.__QFS_TX = (source, values) => {
  let msg = (window.__QFS_UI && window.__QFS_UI[source]) || source;
  if (!values) return msg;
  for (const [k, v] of Object.entries(values)) {
    msg = msg.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
  }
  return msg;
};
</script>
