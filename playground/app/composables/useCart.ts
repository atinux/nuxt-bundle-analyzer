export function useCart() {
  const count = useState('cart', () => 0)
  return {
    count,
    add: () => count.value++,
  }
}
