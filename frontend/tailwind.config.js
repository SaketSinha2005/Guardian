tailwind.config = {
    darkMode: "class",
    theme: {
        extend: {
            "colors": {
                "inverse-on-surface": "#303032",
                "tertiary-container": "#a16600",
                "on-tertiary-fixed": "#2a1700",
                "surface-container-lowest": "#0d0e10",
                "secondary-container": "#00b954",
                "surface-container": "#1f2021",
                "tertiary": "#ffb95f",
                "tertiary-fixed": "#ffddb8",
                "surface-container-highest": "#343536",
                "background": "#131315",
                "error": "#ffb4ab",
                "primary": "#b7c8e1",
                "primary-container": "#64748b",
                "on-primary-fixed-variant": "#38485d",
                "inverse-primary": "#505f76",
                "surface-dim": "#131315",
                "secondary-fixed": "#6bff8f",
                "on-surface-variant": "#c4c6cd",
                "on-primary-fixed": "#0b1c30",
                "outline-variant": "#44474c",
                "on-secondary-fixed-variant": "#005321",
                "inverse-surface": "#e4e2e4",
                "on-surface": "#e4e2e4",
                "on-error-container": "#ffdad6",
                "surface-container-low": "#1b1b1d",
                "on-primary": "#213145",
                "surface-tint": "#b7c8e1",
                "surface": "#131315",
                "surface-bright": "#39393b",
                "on-tertiary-container": "#fff9f5",
                "primary-fixed": "#d3e4fe",
                "surface-container-high": "#292a2b",
                "on-tertiary-fixed-variant": "#653e00",
                "secondary": "#4ae176",
                "on-background": "#e4e2e4",
                "on-secondary-container": "#004119",
                "primary-fixed-dim": "#b7c8e1",
                "on-primary-container": "#f9f9ff",
                "surface-variant": "#343536",
                "on-error": "#690005",
                "tertiary-fixed-dim": "#ffb95f",
                "outline": "#8e9197",
                "error-container": "#93000a",
                "on-secondary-fixed": "#002109",
                "on-secondary": "#003915",
                "secondary-fixed-dim": "#4ae176",
                "on-tertiary": "#472a00"
            },
            "borderRadius": {
                "DEFAULT": "0.125rem",
                "lg": "0.25rem",
                "xl": "0.5rem",
                "full": "0.75rem"
            },
            "spacing": {
                "gutter": "12px",
                "container-padding": "16px",
                "list-item-gap": "4px",
                "unit": "4px",
                "section-gap": "24px"
            },
            "fontFamily": {
                "body-md": ["Inter"],
                "code-md": ["JetBrains Mono"],
                "headline-lg": ["Inter"],
                "code-sm": ["JetBrains Mono"],
                "body-sm": ["Inter"],
                "headline-md": ["Inter"],
                "label-caps": ["Inter"]
            },
            "fontSize": {
                "body-md": ["14px", { "lineHeight": "20px", "fontWeight": "400" }],
                "code-md": ["13px", { "lineHeight": "20px", "fontWeight": "400" }],
                "headline-lg": ["24px", { "lineHeight": "32px", "letterSpacing": "-0.02em", "fontWeight": "600" }],
                "code-sm": ["11px", { "lineHeight": "16px", "fontWeight": "500" }],
                "body-sm": ["12px", { "lineHeight": "16px", "fontWeight": "400" }],
                "headline-md": ["18px", { "lineHeight": "24px", "letterSpacing": "-0.01em", "fontWeight": "600" }],
                "label-caps": ["10px", { "lineHeight": "12px", "letterSpacing": "0.05em", "fontWeight": "700" }]
            }
        }
    }
};