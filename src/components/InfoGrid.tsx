interface InfoGridProps {
  items: Array<{ label: string; value: string | number }>;
  columns?: 2 | 3 | 4;
}

export const InfoGrid = ({ items, columns = 2 }: InfoGridProps) => {
  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-4"
  };

  return (
    <div className={`grid ${gridCols[columns]} gap-4 text-sm`}>
      {items.map((item, idx) => (
        <div key={idx}>
          <span className="font-semibold">{item.label}:</span> {item.value || 'N/A'}
        </div>
      ))}
    </div>
  );
};
