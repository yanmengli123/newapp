"""Chart style configuration for consistent, publication-quality figures."""

import plotly.graph_objects as go
from plotly import template as plotly_template

# =============================================================================
# Color palette - scientific, professional, low-saturation
# =============================================================================
COLORS = {
    "primary": "#2E86AB",      # Deep blue - main color
    "secondary": "#17A2B8",    # Teal
    "accent1": "#5DADE2",      # Light blue
    "accent2": "#76D7C4",      # Mint green
    "accent3": "#48C9B0",      # Sea green
    "accent4": "#3498DB",      # Sky blue
    "accent5": "#1ABC9C",      # Emerald
    "accent6": "#2980B9",      # Strong blue
    "orange": "#E67E22",       # Orange accent
    "red": "#E74C3C",          # Red for highlights
    "gray_dark": "#34495E",    # Dark gray for text
    "gray": "#7F8C8D",         # Medium gray
    "gray_light": "#BDC3C7",   # Light gray
    "bg": "#FFFFFF",           # White background
    "grid": "#ECF0F1",         # Grid line color
}

# Bar chart color sequences (ordered for visual appeal)
BAR_COLORS = [
    COLORS["primary"],
    COLORS["secondary"],
    COLORS["accent1"],
    COLORS["accent2"],
    COLORS["accent3"],
    COLORS["accent4"],
    COLORS["accent5"],
    COLORS["accent6"],
    COLORS["orange"],
]

# Scientific blue gradient for heatmaps
HEATMAP_COLORS = [
    [0.0, "#F7FBFF"],
    [0.25, "#C6DBEF"],
    [0.5, "#6BAED6"],
    [0.75, "#2171B5"],
    [1.0, "#084594"],
]

# =============================================================================
# Layout template - applied to all charts
# =============================================================================
CAROUSEL_WIDTH = 1600
CAROUSEL_HEIGHT = 900
GENERAL_WIDTH = 1200
GENERAL_HEIGHT = 700

# Standard margins (pixels)
MARGIN = dict(l=80, r=60, t=80, b=80, pad=10)
CAROUSEL_MARGIN = dict(l=90, r=70, t=90, b=90, pad=15)

# Font settings
FONT_FAMILY = "Arial, Helvetica, sans-serif"
TITLE_FONT_SIZE = 18
AXIS_TITLE_FONT_SIZE = 14
AXIS_FONT_SIZE = 12
LEGEND_FONT_SIZE = 12

# Title y position
TITLE_Y = 0.98
TITLE_X = 0.5

# =============================================================================
# Layout factory
# =============================================================================
def get_layout(
    title: str,
    xaxis_title: str = None,
    yaxis_title: str = None,
    width: int = CAROUSEL_WIDTH,
    height: int = CAROUSEL_HEIGHT,
    yaxis2_title: str = None,
    barmode: str = None,
    show_legend: bool = True,
    log_x: bool = False,
    log_y: bool = False,
) -> dict:
    """Get a standardized layout for scientific charts."""
    layout = dict(
        paper_bgcolor=COLORS["bg"],
        plot_bgcolor=COLORS["bg"],
        font=dict(
            family=FONT_FAMILY,
            size=AXIS_FONT_SIZE,
            color=COLORS["gray_dark"],
        ),
        title=dict(
            text=title,
            font=dict(size=TITLE_FONT_SIZE, color=COLORS["gray_dark"]),
            x=TITLE_X,
            y=TITLE_Y,
            xanchor="center",
            yanchor="top",
        ),
        margin=CarouselMargin(width, height),
        showlegend=show_legend,
        legend=dict(
            font=dict(size=LEGEND_FONT_SIZE, color=COLORS["gray_dark"]),
            bgcolor="rgba(255,255,255,0.8)",
            bordercolor=COLORS["grid"],
            borderwidth=1,
        ),
        xaxis=dict(
            title=dict(text=xaxis_title or "", font=dict(size=AXIS_TITLE_FONT_SIZE, color=COLORS["gray_dark"])),
            showgrid=True,
            gridcolor=COLORS["grid"],
            gridwidth=1,
            zeroline=False,
            showline=True,
            linewidth=1,
            linecolor=COLORS["gray_light"],
            tickfont=dict(size=AXIS_FONT_SIZE),
            automargin=True,
            fixedrange=False,
        ),
        yaxis=dict(
            title=dict(text=yaxis_title or "", font=dict(size=AXIS_TITLE_FONT_SIZE, color=COLORS["gray_dark"])),
            showgrid=True,
            gridcolor=COLORS["grid"],
            gridwidth=1,
            zeroline=False,
            showline=True,
            linewidth=1,
            linecolor=COLORS["gray_light"],
            tickfont=dict(size=AXIS_FONT_SIZE),
            automargin=True,
            fixedrange=False,
            rangemode="tozero",
        ),
        width=width,
        height=height,
    )

    if barmode:
        layout["barmode"] = barmode

    if log_x:
        layout["xaxis"]["type"] = "log"
    if log_y:
        layout["yaxis"]["type"] = "log"

    if yaxis2_title:
        layout["yaxis2"] = dict(
            title=dict(text=yaxis2_title, font=dict(size=AXIS_TITLE_FONT_SIZE, color=COLORS["gray_dark"])),
            showgrid=False,
            overlaying="y",
            side="right",
            tickfont=dict(size=AXIS_FONT_SIZE),
            automargin=True,
        )

    return layout


def CarouselMargin(width: int, height: int) -> dict:
    """Get larger margins for carousel-sized charts."""
    return dict(l=90, r=70, t=90, b=90, pad=15)


# =============================================================================
# Figure helpers
# =============================================================================
def bar_trace(
    x,
    y,
    name: str = "",
    color: str = None,
    orientation: str = "v",
    opacity: float = 0.85,
) -> go.Bar:
    """Create a styled bar trace."""
    return go.Bar(
        x=x,
        y=y,
        name=name,
        orientation=orientation,
        marker=dict(
            color=color or COLORS["primary"],
            line=dict(color="rgba(0,0,0,0.1)", width=0.5),
            opacity=opacity,
        ),
        textposition="outside",
        textfont=dict(size=11, color=COLORS["gray_dark"]),
    )


def histogram_trace(
    x,
    name: str = "",
    color: str = None,
    nbins: int = 30,
    opacity: float = 0.8,
) -> go.Histogram:
    """Create a styled histogram trace."""
    return go.Histogram(
        x=x,
        name=name,
        nbinsx=nbins,
        marker=dict(
            color=color or COLORS["primary"],
            line=dict(color="rgba(0,0,0,0.15)", width=0.5),
            opacity=opacity,
        ),
    )


def line_trace(
    x,
    y,
    name: str = "",
    color: str = None,
    width: float = 2,
    mode: str = "lines",
) -> go.Scatter:
    """Create a styled line trace."""
    return go.Scatter(
        x=x,
        y=y,
        name=name,
        mode=mode,
        line=dict(color=color or COLORS["primary"], width=width),
        marker=dict(size=4, color=color or COLORS["primary"]),
    )


def heatmap_trace(z, x=None, y=None, colorscale=None, **kwargs) -> go.Heatmap:
    """Create a styled heatmap trace."""
    return go.Heatmap(
        z=z,
        x=x,
        y=y,
        colorscale=colorscale or HEATMAP_COLORS,
        colorbar=dict(
            title=dict(font=dict(size=AXIS_TITLE_FONT_SIZE, color=COLORS["gray_dark"])),
            tickfont=dict(size=AXIS_FONT_SIZE, color=COLORS["gray_dark"]),
        ),
        **kwargs,
    )


def grouped_bar_traces(data_dict: dict, colors: list = None) -> list:
    """Create grouped bar traces from dict of {name: [values]}."""
    traces = []
    for i, (name, values) in enumerate(data_dict.items()):
        color = (colors or BAR_COLORS)[i % len(colors or BAR_COLORS)]
        traces.append(bar_trace(name=name, y=values, color=color))
    return traces
