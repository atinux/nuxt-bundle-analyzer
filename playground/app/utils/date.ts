export const formatDate = (date: Date) => new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(date)
