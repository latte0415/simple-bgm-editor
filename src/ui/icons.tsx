const P = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.25 } as const;

export const IconPlay = () => (<svg {...P}><path d="M3.5 2.5v9l7.5-4.5z" strokeLinejoin="round" /></svg>);
export const IconStop = () => (<svg {...P}><rect x="3" y="3" width="8" height="8" /></svg>);
export const IconLoop = () => (<svg {...P}><path d="M2.5 6V4.5h8l-2-2M11.5 8v1.5h-8l2 2" /></svg>);
export const IconFollow = () => (<svg {...P}><path d="M2 7h9M8 4l3 3-3 3" /><path d="M12.5 2v10" /></svg>);
export const IconUndo = () => (<svg {...P}><path d="M4.5 3 2 5.5 4.5 8" /><path d="M2 5.5h6.5a3 3 0 0 1 0 6H6" /></svg>);
export const IconRedo = () => (<svg {...P}><path d="M9.5 3 12 5.5 9.5 8" /><path d="M12 5.5H5.5a3 3 0 0 0 0 6H8" /></svg>);
export const IconMinus = () => (<svg {...P}><path d="M3 7h8" /></svg>);
export const IconPlus = () => (<svg {...P}><path d="M3 7h8M7 3v8" /></svg>);
export const IconFit = () => (<svg {...P}><path d="M2 4V2h2M10 2h2v2M12 10v2h-2M4 12H2v-2" /><path d="M5 7h4" /></svg>);
export const IconMagnet = () => (<svg {...P}><path d="M3 2.5v4.5a4 4 0 0 0 8 0V2.5" /><path d="M3 5h2.5M8.5 5H11" /><path d="M5.5 2.5V7a1.5 1.5 0 0 0 3 0V2.5" /></svg>);
export const IconClose = () => (<svg {...P}><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" /></svg>);
export const IconDownload = () => (<svg {...P}><path d="M7 2v7M4 6.5 7 9.5l3-3M2.5 12h9" /></svg>);
export const IconFile = () => (<svg {...P}><path d="M3 1.5h5l3 3v8H3z" /><path d="M8 1.5v3h3" /></svg>);
