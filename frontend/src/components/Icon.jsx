const paths = {
  cube: "M12 2.8 20 7v10l-8 4.2L4 17V7l8-4.2Zm0 0V12m8-5-8 5-8-5M4 17l8-5 8 5",
  network: "M6.5 6.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17.5 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 22.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8.7 5.6l6.6 3.8M15.3 10.6l-6.6 7.8",
  layers: "M12 3 3 7.5 12 12l9-4.5L12 3Zm-9 9 9 4.5 9-4.5M3 16.5 12 21l9-4.5",
  compose: "M6 3h8l4 4v14H6V3Zm8 0v5h5M9 13h6M9 17h4",
  download: "M12 3v11m0 0 4-4m-4 4-4-4M4 18v3h16v-3",
  upload: "M12 21V10m0 0 4 4m-4-4-4 4M4 6V3h16v3",
  package: "M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9ZM4 7.5l8 4.5 8-4.5M12 12v9",
  plus: "M12 5v14M5 12h14",
  search: "m21 21-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  play: "m9 5 10 7-10 7V5Z",
  stop: "M7 7h10v10H7z",
  restart: "M20 11a8 8 0 1 0 1.1 4.1M20 5v6h-6",
  trash: "M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14",
  close: "M6 6l12 12M18 6 6 18",
  settings: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.3.9a7.3 7.3 0 0 0-1.9-1.1L14.5 3h-4l-.4 2.7a7.3 7.3 0 0 0-1.9 1.1l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.1l-2 1.5 2 3.4 2.3-.9a7.3 7.3 0 0 0 1.9 1.1l.4 2.7h4l.4-2.7a7.3 7.3 0 0 0 1.9-1.1l2.3.9 2-3.4-2-1.5c.1-.3.1-.7.1-1.1Z",
  activity: "M3 12h4l2-7 4 14 2-7h6",
  logs: "M5 4h14v16H5V4Zm4 5h6M9 13h6M9 17h3",
  cpu: "M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3M7 7h10v10H7V7Z",
  link: "M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1",
  terminal: "M4 5h16v14H4V5Zm3 4 3 3-3 3m5 0h4",
  sun: "M12 3v2m0 14v2M3 12h2m14 0h2m-2.6-6.4-1.4 1.4M6.8 17.2l-1.4 1.4m0-13 1.4 1.4m10.4 10.4 1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  moon: "M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z",
  chevron: "m9 18 6-6-6-6",
};

export default function Icon({ name, size = 18, stroke = 1.8, className = "" }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.cube} />
    </svg>
  );
}
