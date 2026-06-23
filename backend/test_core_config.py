"""Core backend configuration regression tests."""

from pathlib import Path


def test_chr_nc_fallback_maps_chr19_and_chr20_to_distinct_accessions(tmp_path: Path):
    import backend.main as main

    original_rawdata_root = main.RAWDATA_ROOT
    main.RAWDATA_ROOT = tmp_path / "rawdata"
    main.RAWDATA_ROOT.mkdir()
    try:
        fallback = main._load_chr_nc_map()
    finally:
        main.RAWDATA_ROOT = original_rawdata_root

    assert fallback["chr19"] == "NC_006106.5"
    assert fallback["chr20"] == "NC_006107.5"
    assert fallback["chr19"] != fallback["chr20"]


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        test_chr_nc_fallback_maps_chr19_and_chr20_to_distinct_accessions(Path(tmp))
    print("All core config tests passed.")
