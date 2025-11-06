interface ServiceBadgesProps {
  electricity?: boolean;
  gas?: boolean;
  broadband?: boolean;
}

export const ServiceBadges = ({ electricity, gas, broadband }: ServiceBadgesProps) => {
  return (
    <div className="flex gap-2">
      {electricity && (
        <span className="px-3 py-1 bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 rounded-full text-sm">
          ⚡ Electricity
        </span>
      )}
      {gas && (
        <span className="px-3 py-1 bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-full text-sm">
          🔥 Gas
        </span>
      )}
      {broadband && (
        <span className="px-3 py-1 bg-purple-500/20 text-purple-700 dark:text-purple-300 rounded-full text-sm">
          📡 Broadband
        </span>
      )}
    </div>
  );
};
