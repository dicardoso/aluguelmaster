// Centralizes the "R$ 1.500,00" formatting that used to be duplicated ad hoc across
// pages — some call sites omitted minimumFractionDigits, so "R$ 1.500" and "R$ 1.500,00"
// both showed up depending on the screen.
export const formatCurrency = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
