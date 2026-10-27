// Which SOP step each automatic check comes from. Shown next to the checks
// and in the Excel file so a reviewer can find the rule in sop.html.
export const SOP_VERSION = '23 Oct 2026';

const MAP = [
  [/^Debits equal credits/, [23, 26]],
  [/^Each employee block balances/, [17]],
  [/^Every pay code/, [13]],
  [/^Employees add up/, [25]],
  [/^Employee count/, [8]],
  [/^Pay lines equal/, [25]],
  [/^Every class exists/, [22, 26]],
  [/^Every employee is on the Employee List/, [9, 10, 11, 27]],
  [/^Report was run/, [5]]
];

export function sopSteps(checkName) {
  const hit = MAP.find(([re]) => re.test(checkName));
  return hit ? hit[1] : [];
}

export const sopLabel = steps => (steps.length ? `SOP step${steps.length > 1 ? 's' : ''} ${steps.join(', ')}` : '');
