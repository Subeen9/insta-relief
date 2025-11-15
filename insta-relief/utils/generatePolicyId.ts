
export function generatePolicyId(zip: string) {
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `POL-${zip}-${random}`;
}
