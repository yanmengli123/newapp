"""Chart exporter: generate PNG, SVG, HTML, JSON from Plotly figures."""

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("grcg6a_fastapi_backend.chart_exporter")

# Carousel dimensions
CAROUSEL_WIDTH = 1600
CAROUSEL_HEIGHT = 900

# General chart dimensions
GENERAL_WIDTH = 1200
GENERAL_HEIGHT = 700


def export_chart(
    fig,
    output_path: Path,
    title: str = None,
    width: int = CAROUSEL_WIDTH,
    height: int = CAROUSEL_HEIGHT,
) -> dict:
    """
    Export a Plotly figure to PNG, SVG, HTML, JSON formats.

    Args:
        fig: Plotly figure object
        output_path: Output file path (without extension)
        title: Optional title override
        width: Image width in pixels
        height: Image height in pixels

    Returns:
        dict with export status for each format
    """
    results = {
        "png": None,
        "svg": None,
        "html": None,
        "json": None,
    }

    # Update layout with dimensions
    if title:
        fig.update_layout(title=dict(text=title, x=0.5, y=0.98))

    fig.update_layout(width=width, height=height)

    # Export JSON (always try first - no external dependencies)
    try:
        json_path = Path(str(output_path).replace(".html", ".json").replace(".png", "").replace(".svg", "") + ".json")
        fig.write_json(json_path)
        results["json"] = str(json_path)
        logger.debug(f"Exported JSON: {json_path}")
    except Exception as e:
        logger.warning(f"Failed to export JSON: {e}")

    # Export HTML
    try:
        html_path = Path(str(output_path).replace(".json", ".html").replace(".png", ".html").replace(".svg", ".html"))
        if html_path.suffix != ".html":
            html_path = html_path.parent / (html_path.stem + ".html")

        fig.write_html(
            html_path,
            include_plotlyjs="cdn",
            full_html=True,
            config={
                "displayModeBar": True,
                "scrollZoom": True,
                "responsive": True,
            },
        )
        results["html"] = str(html_path)
        logger.debug(f"Exported HTML: {html_path}")
    except Exception as e:
        logger.warning(f"Failed to export HTML: {e}")

    # Export PNG via Kaleido
    try:
        png_path = Path(str(output_path).replace(".json", ".png").replace(".html", ".png").replace(".svg", ".png"))
        if png_path.suffix != ".png":
            png_path = png_path.parent / (png_path.stem + ".png")

        fig.write_image(
            png_path,
            format="png",
            width=width,
            height=height,
            scale=2,  # High resolution
            engine="kaleido",
        )
        results["png"] = str(png_path)
        logger.debug(f"Exported PNG: {png_path}")
    except Exception as e:
        logger.warning(f"Failed to export PNG (kaleido): {e}")

    # Export SVG
    try:
        svg_path = Path(str(output_path).replace(".json", ".svg").replace(".html", ".svg").replace(".png", ".svg"))
        if svg_path.suffix != ".svg":
            svg_path = svg_path.parent / (svg_path.stem + ".svg")

        fig.write_image(
            svg_path,
            format="svg",
            width=width,
            height=height,
            scale=2,
            engine="kaleido",
        )
        results["svg"] = str(svg_path)
        logger.debug(f"Exported SVG: {svg_path}")
    except Exception as e:
        logger.warning(f"Failed to export SVG: {e}")

    return results


def save_figure(
    fig,
    key: str,
    charts_dir: Path,
    width: int = CAROUSEL_WIDTH,
    height: int = CAROUSEL_HEIGHT,
    title: str = None,
) -> dict:
    """
    Save figure with standardized naming.

    Args:
        fig: Plotly figure
        key: Chart key (e.g., "assembly_contig_length_bar")
        charts_dir: Output directory
        width: Image width
        height: Image height
        title: Chart title

    Returns:
        dict with exported file paths
    """
    charts_dir.mkdir(parents=True, exist_ok=True)
    output_path = charts_dir / key

    results = export_chart(
        fig,
        output_path,
        title=title,
        width=width,
        height=height,
    )

    return {
        "key": key,
        "title": title or key,
        "files": {k: v for k, v in results.items() if v},
        "dimensions": {"width": width, "height": height},
    }


def create_and_save_bar(
    x,
    y,
    key: str,
    charts_dir: Path,
    title: str = None,
    xaxis_title: str = None,
    yaxis_title: str = None,
    color: str = None,
    orientation: str = "v",
    top_n: int = 20,
) -> Optional[dict]:
    """Create and save a bar chart."""
    try:
        from plotly import graph_objects as go
        from genome_analysis.chart_styles import (
            get_layout, bar_trace, COLORS, BAR_COLORS
        )

        # Take top N
        if len(x) > top_n:
            pairs = sorted(zip(x, y), key=lambda p: p[1], reverse=True)[:top_n]
            x, y = zip(*pairs)

        fig = go.Figure()

        if orientation == "h":
            fig.add_trace(go.Bar(
                x=y, y=x, orientation="h",
                marker=dict(
                    color=color or BAR_COLORS[0],
                    line=dict(color="rgba(0,0,0,0.1)", width=0.5),
                    opacity=0.85,
                ),
                text=y,
                textposition="outside",
                textfont=dict(size=10),
            ))
            fig.update_yaxes(autorange="reversed")
        else:
            fig.add_trace(go.Bar(
                x=x, y=y,
                marker=dict(
                    color=color or BAR_COLORS[0],
                    line=dict(color="rgba(0,0,0,0.1)", width=0.5),
                    opacity=0.85,
                ),
                text=y,
                textposition="outside",
                textfont=dict(size=10),
            ))

        fig.update_layout(
            **get_layout(
                title=title or key,
                xaxis_title=xaxis_title,
                yaxis_title=yaxis_title,
                width=CAROUSEL_WIDTH,
                height=CAROUSEL_HEIGHT,
            )
        )

        return save_figure(fig, key, charts_dir, title=title)
    except Exception as e:
        logger.error(f"Failed to create bar chart {key}: {e}")
        return None


def create_and_save_histogram(
    x,
    key: str,
    charts_dir: Path,
    title: str = None,
    xaxis_title: str = None,
    yaxis_title: str = None,
    color: str = None,
    nbins: int = 30,
) -> Optional[dict]:
    """Create and save a histogram."""
    try:
        from plotly import graph_objects as go
        from genome_analysis.chart_styles import get_layout, COLORS

        fig = go.Figure()
        fig.add_trace(go.Histogram(
            x=x, nbinsx=nbins,
            marker=dict(
                color=color or COLORS["primary"],
                line=dict(color="rgba(0,0,0,0.15)", width=0.5),
                opacity=0.8,
            ),
        ))

        fig.update_layout(
            **get_layout(
                title=title or key,
                xaxis_title=xaxis_title,
                yaxis_title=yaxis_title or "频数",
                width=CAROUSEL_WIDTH,
                height=CAROUSEL_HEIGHT,
            ),
            bargap=0.05,
        )

        return save_figure(fig, key, charts_dir, title=title)
    except Exception as e:
        logger.error(f"Failed to create histogram {key}: {e}")
        return None


def create_and_save_line(
    x,
    y,
    key: str,
    charts_dir: Path,
    title: str = None,
    xaxis_title: str = None,
    yaxis_title: str = None,
    color: str = None,
    fill: str = None,
) -> Optional[dict]:
    """Create and save a line chart."""
    try:
        from plotly import graph_objects as go
        from genome_analysis.chart_styles import get_layout, COLORS

        fill_args = {}
        if fill:
            fill_args["fill"] = fill
            fill_args["fillcolor"] = "rgba(46,134,171,0.2)"

        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=x, y=y,
            mode="lines",
            line=dict(color=color or COLORS["primary"], width=2),
            marker=dict(size=4, color=color or COLORS["primary"]),
            **fill_args,
        ))

        fig.update_layout(
            **get_layout(
                title=title or key,
                xaxis_title=xaxis_title,
                yaxis_title=yaxis_title,
                width=CAROUSEL_WIDTH,
                height=CAROUSEL_HEIGHT,
            )
        )

        return save_figure(fig, key, charts_dir, title=title)
    except Exception as e:
        logger.error(f"Failed to create line chart {key}: {e}")
        return None


def create_and_save_grouped_bar(
    categories: list,
    series_dict: dict,
    key: str,
    charts_dir: Path,
    title: str = None,
    xaxis_title: str = None,
    yaxis_title: str = None,
) -> Optional[dict]:
    """Create and save a grouped bar chart."""
    try:
        from plotly import graph_objects as go
        from genome_analysis.chart_styles import get_layout, BAR_COLORS

        fig = go.Figure()
        for i, (name, values) in enumerate(series_dict.items()):
            fig.add_trace(go.Bar(
                x=categories, y=values,
                name=name,
                marker=dict(
                    color=BAR_COLORS[i % len(BAR_COLORS)],
                    line=dict(color="rgba(0,0,0,0.1)", width=0.5),
                    opacity=0.85,
                ),
            ))

        fig.update_layout(
            **get_layout(
                title=title or key,
                xaxis_title=xaxis_title,
                yaxis_title=yaxis_title,
                width=CAROUSEL_WIDTH,
                height=CAROUSEL_HEIGHT,
                barmode="group",
            )
        )

        return save_figure(fig, key, charts_dir, title=title)
    except Exception as e:
        logger.error(f"Failed to create grouped bar chart {key}: {e}")
        return None
