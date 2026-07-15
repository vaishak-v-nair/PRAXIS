export function feedback() {
  const url = 'https://github.com/vaishak-v-nair/PRAXIS/issues/new?title=feedback';
  console.log(`
PRAXIS is free and local. Two questions decide whether it becomes more:

  1. What would make you PAY for PRAXIS?
  2. Would you pay for it? How much per month?

"No" is as useful as "yes" — tell me straight.
  ${url}
`);
}
