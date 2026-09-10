// Multa (2% fixa) + juros de mora (1% ao mês, pro-rata pelos dias em atraso) — o mesmo
// texto já presente no contrato PDF gerado ("multa de 2%... juros de mora à razão de
// 12% ao ano"). Puramente informativo: nunca é persistido em Payment.amount, só calculado
// na hora para exibição (lista de pagamentos, recibo) quando o contrato tem
// lateFeeEnabled = true.
export interface LateFeeBreakdown {
  daysLate: number;
  fine: number;
  interest: number;
  total: number;
}

const FINE_RATE = 0.02;
const MONTHLY_INTEREST_RATE = 0.01;

export function calculateLateFee(amount: number, dueDate: string, referenceDate: Date = new Date()): LateFeeBreakdown {
  const due = new Date(dueDate);
  const daysLate = Math.floor((referenceDate.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLate <= 0) {
    return { daysLate: 0, fine: 0, interest: 0, total: amount };
  }

  const fine = amount * FINE_RATE;
  const interest = amount * MONTHLY_INTEREST_RATE * (daysLate / 30);
  return { daysLate, fine, interest, total: amount + fine + interest };
}
