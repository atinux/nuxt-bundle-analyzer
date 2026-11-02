export const formatPrice = (value: number) => new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(value)
