interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Input de busca genérico (extraído do padrão inline usado em UsersPage/CategoriesPage). */
export function SearchInput({ value, onChange, placeholder = "Buscar..." }: SearchInputProps) {
  return (
    <input
      type="search"
      placeholder={placeholder}
      className="block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
