import { useEffect, useMemo, useState } from "react";
import { RiDownloadCloudLine } from "@remixicon/react";
import { useProjectNamedColorSwatches } from "../colors/project-named-colors";
import { useEditorStore } from "../store/store";
import { getActiveEditorPlatform } from "../platform/current";
import { NODE_SHAPE_OPTIONS } from "tikz-editor/edit/inspector";
import { ColorPicker, cssColorForToken } from "./ColorPicker";
import { getToolCapabilityStatus } from "./capabilities";
import { RenderedTooltip } from "./RenderedTooltip";
import {
  resolveToolbarToolMode,
  TOOL_BUTTONS,
  TOOL_COLOR_OPTIONS,
  CaretDownIcon,
  type ToolPopupKind
} from "./tool-config";
import { GENERATED_NODE_SHAPE_PREVIEWS } from "./generated-node-shape-previews";
import { ToolbarToolPopup, ToolbarPopupSection, ToolbarPopupVisualChoiceGrid } from "./ToolbarToolPopup";
import popupCss from "./ToolbarToolPopup.module.css";
import type { ToolMode } from "../store/types";
import css from "./Toolbar.module.css";
import { FormatPainterButton } from "./format-painter";

const COMMON_SHAPES = ["rectangle", "circle", "ellipse", "isosceles triangle", "diamond", "trapezium", "regular polygon"];
const SHAPE_POPUP_CHOICES = [
  { id: "square", label: "正方形", previewSvg: '<svg viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" fill="none" stroke="currentColor"/></svg>' },
  { id: "round-corner rectangle", label: "圆角矩形", previewSvg: '<svg viewBox="0 0 32 32"><rect x="3" y="7" width="26" height="18" rx="4" fill="none" stroke="currentColor"/></svg>' },
  ...[...NODE_SHAPE_OPTIONS].sort((a, b) => (COMMON_SHAPES.includes(a.value) ? COMMON_SHAPES.indexOf(a.value) : 99) - (COMMON_SHAPES.includes(b.value) ? COMMON_SHAPES.indexOf(b.value) : 99)).map((option) => ({
  id: option.value,
  label: option.label,
  previewSvg: GENERATED_NODE_SHAPE_PREVIEWS[option.value] ?? null
}))];

type ToolbarProps = {
  projectMode?: boolean;
  updateChip?: {
    version: string;
    onClick: () => void;
  } | null;
};

export function Toolbar({ projectMode = false, updateChip = null }: ToolbarProps) {
  const toolMode = useEditorStore((s) => s.toolMode);
  const bucketFillColor = useEditorStore((s) => s.bucketFillColor);
  const selectedAddShape = useEditorStore((s) => s.selectedAddShape);
  const selectedAddMatrixRows = useEditorStore((s) => s.selectedAddMatrixRows);
  const selectedAddMatrixColumns = useEditorStore((s) => s.selectedAddMatrixColumns);
  const matrixStyle = useEditorStore((s) => s.selectedAddMatrixStyle);
  const [matrixOrientation, setMatrixOrientation] = useState<"matrix" | "row" | "column">("matrix");
  const dispatch = useEditorStore((s) => s.dispatch);
  const projectNamedColorSwatches = useProjectNamedColorSwatches();
  const namedColorLookup = useMemo(
    () => new Map(projectNamedColorSwatches.map((swatch) => [swatch.token, swatch.cssColor] as const)),
    [projectNamedColorSwatches]
  );
  const [openPopupMode, setOpenPopupMode] = useState<ToolMode | null>(null);
  const [bucketPopupClosePending, setBucketPopupClosePending] = useState(false);
  const [matrixHoverSize, setMatrixHoverSize] = useState<{ rows: number; columns: number } | null>(null);
  const matrixPreviewRows = matrixHoverSize?.rows ?? selectedAddMatrixRows;
  const matrixPreviewColumns = matrixHoverSize?.columns ?? selectedAddMatrixColumns;
  const isDesktop = getActiveEditorPlatform().id.startsWith("desktop");
  const isMacDesktop =
    isDesktop &&
    typeof navigator !== "undefined" &&
    /(mac|iphone|ipad)/i.test(navigator.platform);
  const showAppTitle = !isDesktop && !projectMode;

  // Close popup when tool mode changes (unless it's a popup that can be used independently)
  useEffect(() => {
    if (openPopupMode && openPopupMode !== "addShape" && openPopupMode !== "addBucket" && openPopupMode !== "addMatrix" && openPopupMode !== toolMode) {
      setOpenPopupMode(null);
    }
  }, [openPopupMode, toolMode]);

  useEffect(() => {
    if (openPopupMode !== "addBucket" && bucketPopupClosePending) {
      setBucketPopupClosePending(false);
    }
  }, [bucketPopupClosePending, openPopupMode]);

  useEffect(() => {
    if (openPopupMode !== "addBucket" || !bucketPopupClosePending) {
      return;
    }

    function onPointerUp(): void {
      setBucketPopupClosePending(false);
      setOpenPopupMode(null);
    }

    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointerup", onPointerUp); };
  }, [bucketPopupClosePending, openPopupMode]);

  const closeBucketPopup = () => {
    setBucketPopupClosePending(false);
    setOpenPopupMode(null);
  };

  const renderPopup = (popupKind: ToolPopupKind) => {
    if (popupKind === "bucket-color") {
      return (
        <ToolbarPopupSection title="Bucket Color">
          <ColorPicker
            ariaLabel="Bucket fill color"
            value={bucketFillColor}
            syntaxValue={bucketFillColor}
            options={TOOL_COLOR_OPTIONS}
            namedColorSwatches={projectNamedColorSwatches}
            onChange={(nextValue) => {
              dispatch({ type: "SET_BUCKET_FILL_COLOR", value: nextValue });
              // Auto-activate bucket tool after selecting a color
              dispatch({ type: "SET_TOOL_MODE", mode: "addBucket" });
              setBucketPopupClosePending(true);
            }}
          />
        </ToolbarPopupSection>
      );
    }
    if (popupKind === "shape-picker") {
      return (
        <ToolbarPopupSection title="Shape">
          <ToolbarPopupVisualChoiceGrid
            choices={SHAPE_POPUP_CHOICES}
            selectedId={selectedAddShape}
            onSelect={(id) => {
              dispatch({ type: "SET_ADD_SHAPE_PRESET", value: id as typeof selectedAddShape });
              // Activate the shape tool and close popup
              dispatch({ type: "SET_TOOL_MODE", mode: "addShape" });
              setOpenPopupMode(null);
            }}
            testIdPrefix="toolbar-shape-choice"
          />
        </ToolbarPopupSection>
      );
    }
    if (popupKind === "matrix-picker") {
      const maxColumns = matrixOrientation === "column" ? 1 : 10;
      const maxRows = matrixOrientation === "row" ? 1 : 8;
      const isSelected = (row: number, column: number): boolean =>
        row <= matrixPreviewRows && column <= matrixPreviewColumns;
      return (
        <ToolbarPopupSection title={`Insert Matrix (${matrixPreviewColumns} x ${matrixPreviewRows})`}>
          <label>布局 <select aria-label="矩阵布局" value={matrixOrientation} onChange={(event) => {
            const orientation = event.currentTarget.value as typeof matrixOrientation;
            setMatrixOrientation(orientation);
            if (orientation !== "matrix" && (matrixStyle === "default" || matrixStyle === "math")) {
              dispatch({ type: "SET_ADD_MATRIX_PRESET", rows: orientation === "row" ? 1 : 3, columns: orientation === "column" ? 1 : 3, style: "grid-empty" });
            }
          }}><option value="matrix">矩阵</option><option value="row">行向量</option><option value="column">列向量</option></select></label>
          <label>内容 <select aria-label="矩阵内容" value={matrixStyle} onChange={(event) => {
            dispatch({ type: "SET_ADD_MATRIX_PRESET", rows: selectedAddMatrixRows, columns: selectedAddMatrixColumns, style: event.currentTarget.value as typeof matrixStyle });
          }}>
            {matrixOrientation === "matrix" ? <><option value="default">普通矩阵</option><option value="math">数学矩阵</option></> : null}
            <option value="grid-empty">空白格</option><option value="grid-text">带文字的方格</option>
          </select></label>
          <div
            className={popupCss.matrixPicker}
            data-testid="toolbar-matrix-picker-grid"
            onMouseLeave={() => { setMatrixHoverSize(null); }}
          >
            {Array.from({ length: maxRows }, (_, rowIndex) => rowIndex + 1).map((row) => (
              <div key={row} className={popupCss.matrixPickerRow}>
                {Array.from({ length: maxColumns }, (_, columnIndex) => columnIndex + 1).map((column) => (
                  <button
                    key={`${row}-${column}`}
                    type="button"
                    className={[
                      popupCss.matrixPickerCell,
                      isSelected(row, column) ? popupCss.matrixPickerCellSelected : ""
                    ].filter(Boolean).join(" ")}
                    onMouseEnter={() => { setMatrixHoverSize({ rows: row, columns: column }); }}
                    onFocus={() => { setMatrixHoverSize({ rows: row, columns: column }); }}
                    onClick={() => {
                      dispatch({ type: "SET_ADD_MATRIX_PRESET", rows: row, columns: column });
                      dispatch({ type: "SET_TOOL_MODE", mode: "addMatrix" });
                      setMatrixHoverSize(null);
                      setOpenPopupMode(null);
                    }}
                    data-testid={`toolbar-matrix-picker-cell-${row}-${column}`}
                    aria-label={`${row} rows by ${column} columns`}
                    aria-selected={isSelected(row, column)}
                  />
                ))}
              </div>
            ))}
          </div>
        </ToolbarPopupSection>
      );
    }
    return null;
  };

  const renderBucketButton = () => {
    const mode = "addBucket" as const;
    const toolDef = TOOL_BUTTONS.find((b) => b.mode === mode)!;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${toolDef.title}\n${capability.reason}`
      : toolDef.title;
    const Icon = toolDef.icon;
    const isActive = toolMode === mode;

    const bucketFillColorCss = cssColorForToken(bucketFillColor, namedColorLookup) ?? "transparent";

    return (
      <ToolbarToolPopup
        key={mode}
        open={openPopupMode === mode}
        onClose={closeBucketPopup}
        popup={renderPopup("bucket-color")}
        popupTestId="toolbar-tool-popup-addBucket"
        popupClassName={popupCss.bucketColorPopup}
      >
        <div className={css.splitButton}>
          <RenderedTooltip content={buttonTitle}>
            <button
              type="button"
              className={[css.btn, css.splitButtonMain, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
              aria-label={toolDef.label}
              disabled={unsupported}
              onClick={() => {
                dispatch({ type: "SET_TOOL_MODE", mode: isActive ? "select" : mode });
                closeBucketPopup();
              }}
            >
              <Icon size={18} />
              <div
                className={css.bucketColorIndicator}
                style={{ backgroundColor: bucketFillColorCss }}
              />
            </button>
          </RenderedTooltip>
          <RenderedTooltip content="Choose bucket color">
            <button
              type="button"
              className={[css.btn, css.splitButtonCaret, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
              aria-label="Choose bucket color"
              aria-haspopup="dialog"
              aria-expanded={openPopupMode === mode}
              disabled={unsupported}
              data-testid="toolbar-bucket-color-caret"
              onClick={(e) => {
                e.stopPropagation();
                setOpenPopupMode((current) => (current === mode ? null : mode));
              }}
            >
              <CaretDownIcon size={8} />
            </button>
          </RenderedTooltip>
        </div>
      </ToolbarToolPopup>
    );
  };

  const renderShapeButton = () => {
    const mode = "addShape" as const;
    const toolDef = TOOL_BUTTONS.find((b) => b.mode === mode)!;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${toolDef.title}\n${capability.reason}`
      : toolDef.title;
    const Icon = toolDef.icon;
    const isActive = toolMode === mode;

    return (
      <ToolbarToolPopup
        key={mode}
        open={openPopupMode === mode}
        onClose={() => { setOpenPopupMode(null); }}
        popup={renderPopup("shape-picker")}
        popupTestId="toolbar-tool-popup-addShape"
      >
        <RenderedTooltip content={buttonTitle}>
          <button
            type="button"
            className={[css.btn, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
            aria-label={toolDef.label}
            aria-haspopup="dialog"
            aria-expanded={openPopupMode === mode}
            disabled={unsupported}
            onClick={() => {
              // Just open the popup, don't activate the tool
              setOpenPopupMode((current) => (current === mode ? null : mode));
            }}
          >
            <Icon size={18} />
          </button>
        </RenderedTooltip>
      </ToolbarToolPopup>
    );
  };

  const renderMatrixButton = () => {
    const mode = "addMatrix" as const;
    const toolDef = TOOL_BUTTONS.find((b) => b.mode === mode)!;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${toolDef.title}\n${capability.reason}`
      : toolDef.title;
    const Icon = toolDef.icon;
    const isActive = toolMode === mode;

    return (
      <ToolbarToolPopup
        key={mode}
        open={openPopupMode === mode}
        onClose={() => {
          setOpenPopupMode(null);
          setMatrixHoverSize(null);
        }}
        popup={renderPopup("matrix-picker")}
        popupTestId="toolbar-tool-popup-addMatrix"
      >
        <RenderedTooltip content={buttonTitle}>
          <button
            type="button"
            className={[css.btn, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
            aria-label={toolDef.label}
            aria-haspopup="dialog"
            aria-expanded={openPopupMode === mode}
            disabled={unsupported}
            onClick={() => {
              setMatrixHoverSize(null);
              setOpenPopupMode((current) => (current === mode ? null : mode));
            }}
          >
            <Icon size={18} />
          </button>
        </RenderedTooltip>
      </ToolbarToolPopup>
    );
  };

  const renderStandardButton = (toolDef: (typeof TOOL_BUTTONS)[number]) => {
    const { mode, label, title, icon: Icon } = toolDef;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${title}\n${capability.reason}`
      : title;
    const nextMode = resolveToolbarToolMode(toolMode, mode);
    const isActive = toolMode === mode;

    return (
      <RenderedTooltip key={mode} content={buttonTitle}>
        <button
          type="button"
          className={[css.btn, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
          aria-label={label}
          disabled={unsupported}
          onClick={() => {
            dispatch({ type: "SET_TOOL_MODE", mode: nextMode });
            setOpenPopupMode(null);
          }}
        >
          <Icon size={18} />
        </button>
      </RenderedTooltip>
    );
  };

  return (
    <div className={`${css.toolbar}${isMacDesktop ? ` ${css.toolbarDesktop}` : ""}`} data-tauri-drag-region data-select="chrome">
      {showAppTitle ? (
        <>
          <span className={css.title}>
            TikZ Bench
          </span>
          <div className={css.separator} />
        </>
      ) : null}

      <div className={css.group}>
        {TOOL_BUTTONS.flatMap((toolDef) => {
          const separator = toolDef.separatorBefore ? <div key={`sep-${toolDef.mode}`} className={css.separator} /> : null;
          // Special handling for bucket and shape buttons
          let button;
          if (toolDef.mode === "addBucket") {
            button = renderBucketButton();
          } else if (toolDef.mode === "addMatrix") {
            button = renderMatrixButton();
          } else if (toolDef.mode === "addShape") {
            button = renderShapeButton();
          } else {
            button = renderStandardButton(toolDef);
          }
          return separator ? [separator, button] : [button];
        })}
      </div>
      <FormatPainterButton className={`${css.btn} ${css.formatPainter}`} />
      <div className={css.spacer} />
      {updateChip ? (
        <RenderedTooltip content={`Install update ${updateChip.version}`}>
          <button
            type="button"
            className={css.updateChip}
            onClick={updateChip.onClick}
            data-testid="toolbar-update-chip"
            aria-label={`Update available: ${updateChip.version}`}
          >
            <RiDownloadCloudLine size={15} aria-hidden="true" />
            <span>Update available</span>
          </button>
        </RenderedTooltip>
      ) : null}
    </div>
  );
}
