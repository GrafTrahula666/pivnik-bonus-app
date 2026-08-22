from __future__ import annotations

import copy
import sys
from dataclasses import dataclass

from PIL import Image
from PySide6.QtCore import Qt, QEvent, QPointF, QSettings
from PySide6.QtGui import QAction, QColor, QImage, QKeySequence, QPainter, QPen, QPixmap, QPolygonF
from PySide6.QtWidgets import (
    QApplication, QColorDialog, QFileDialog, QGraphicsItem, QGraphicsPixmapItem,
    QGraphicsScene, QGraphicsView, QLabel, QMainWindow, QMessageBox, QPushButton,
    QSpinBox, QToolBar
)

from core import Arrow, apply_blur_stroke, save_over_original

APP_NAME = "PhotoMarker"
APP_VERSION = "1.1"
ORG_NAME = "PhotoMarker"
SUPPORTED = "Images (*.jpg *.jpeg *.png *.webp *.bmp)"


def pil_to_pixmap(img: Image.Image) -> QPixmap:
    rgba = img.convert("RGBA")
    data = rgba.tobytes("raw", "RGBA")
    qimg = QImage(data, rgba.width, rgba.height, QImage.Format_RGBA8888).copy()
    return QPixmap.fromImage(qimg)


@dataclass
class EditorState:
    image: Image.Image
    arrows: list[Arrow]


class ArrowItem(QGraphicsItem):
    def __init__(self, arrow: Arrow):
        super().__init__()
        self.arrow = arrow
        self.setZValue(10)

    def boundingRect(self):
        from PySide6.QtCore import QRectF
        a = self.arrow
        pad = max(40.0, a.width * 5.0)
        return QRectF(min(a.x1, a.x2)-pad, min(a.y1, a.y2)-pad,
                      abs(a.x2-a.x1)+2*pad, abs(a.y2-a.y1)+2*pad)

    def paint(self, painter: QPainter, option, widget=None):
        import math
        a = self.arrow
        color = QColor(a.color)
        painter.setPen(QPen(color, a.width, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
        painter.setBrush(color)
        painter.drawLine(QPointF(a.x1, a.y1), QPointF(a.x2, a.y2))
        angle = math.atan2(a.y2-a.y1, a.x2-a.x1)
        head_len = max(a.width * 3.0, 18.0)
        head_half = max(a.width * 1.6, 10.0)
        bx = a.x2 - head_len * math.cos(angle)
        by = a.y2 - head_len * math.sin(angle)
        px = -math.sin(angle)
        py = math.cos(angle)
        painter.drawPolygon(QPolygonF([
            QPointF(a.x2, a.y2),
            QPointF(bx + head_half*px, by + head_half*py),
            QPointF(bx - head_half*px, by - head_half*py),
        ]))


class PhotoView(QGraphicsView):
    def __init__(self, editor: "MainWindow"):
        super().__init__()
        self.editor = editor
        self.setScene(QGraphicsScene(self))
        self.setRenderHints(QPainter.Antialiasing | QPainter.SmoothPixmapTransform)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.AnchorViewCenter)
        self.setDragMode(QGraphicsView.NoDrag)
        self.setBackgroundBrush(QColor("#16181c"))
        self.setViewportUpdateMode(QGraphicsView.FullViewportUpdate)
        self.viewport().setAttribute(Qt.WA_AcceptTouchEvents, True)
        try:
            self.grabGesture(Qt.PinchGesture)
        except Exception:
            pass
        self.drawing = False
        self.start_scene = QPointF()
        self.last_scene = QPointF()
        self.preview: ArrowItem | None = None
        self.blur_points: list[tuple[float, float]] = []
        self.panning = False
        self.pan_last = None

    def zoom_by(self, factor: float):
        current = self.transform().m11()
        target = max(0.10, min(10.0, current * factor))
        if current > 0:
            self.scale(target/current, target/current)
        self.editor.update_zoom_label()

    def wheelEvent(self, event):
        ctrl = bool(event.modifiers() & Qt.ControlModifier)
        if ctrl:
            delta = event.angleDelta().y() or event.pixelDelta().y()
            if delta:
                self.zoom_by(1.12 if delta > 0 else 1/1.12)
                event.accept()
                return
        pd = event.pixelDelta()
        ad = event.angleDelta()
        dx = pd.x() if not pd.isNull() else ad.x() / 2
        dy = pd.y() if not pd.isNull() else ad.y() / 2
        if event.modifiers() & Qt.ShiftModifier and not dx:
            dx, dy = dy, 0
        if dx or dy:
            self.horizontalScrollBar().setValue(self.horizontalScrollBar().value() - int(dx))
            self.verticalScrollBar().setValue(self.verticalScrollBar().value() - int(dy))
            event.accept()
            return
        super().wheelEvent(event)

    def viewportEvent(self, event):
        if event.type() == QEvent.NativeGesture:
            try:
                if event.gestureType() == Qt.ZoomNativeGesture:
                    value = float(event.value())
                    self.zoom_by(max(0.5, min(2.0, 1.0 + value)))
                    return True
            except Exception:
                pass
        if event.type() == QEvent.Gesture:
            try:
                pinch = event.gesture(Qt.PinchGesture)
                if pinch:
                    self.zoom_by(float(pinch.scaleFactor()))
                    return True
            except Exception:
                pass
        return super().viewportEvent(event)

    def mousePressEvent(self, event):
        if not self.editor.has_image:
            return super().mousePressEvent(event)
        if event.button() == Qt.MiddleButton or (event.button() == Qt.LeftButton and self.editor.space_down):
            self.panning = True
            self.pan_last = event.position()
            self.setCursor(Qt.ClosedHandCursor)
            event.accept()
            return
        if event.button() == Qt.LeftButton and self.editor.tool in ("arrow", "blur"):
            p = self.mapToScene(event.position().toPoint())
            if not self.editor.point_inside_image(p):
                return
            self.editor.push_undo()
            self.drawing = True
            self.start_scene = p
            self.last_scene = p
            if self.editor.tool == "arrow":
                a = Arrow(p.x(), p.y(), p.x(), p.y(), self.editor.arrow_width, self.editor.arrow_color)
                self.preview = ArrowItem(a)
                self.scene().addItem(self.preview)
            else:
                self.blur_points = [(p.x(), p.y())]
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self.panning and self.pan_last is not None:
            pos = event.position()
            d = pos - self.pan_last
            self.pan_last = pos
            self.horizontalScrollBar().setValue(self.horizontalScrollBar().value() - int(d.x()))
            self.verticalScrollBar().setValue(self.verticalScrollBar().value() - int(d.y()))
            event.accept()
            return
        if self.drawing:
            p = self.editor.clamp_to_image(self.mapToScene(event.position().toPoint()))
            self.last_scene = p
            if self.editor.tool == "arrow" and self.preview:
                old = self.preview.arrow
                self.preview.prepareGeometryChange()
                self.preview.arrow = Arrow(old.x1, old.y1, p.x(), p.y(), old.width, old.color)
                self.preview.update()
            elif self.editor.tool == "blur":
                if not self.blur_points or abs(p.x()-self.blur_points[-1][0]) + abs(p.y()-self.blur_points[-1][1]) >= 3:
                    self.blur_points.append((p.x(), p.y()))
                self.viewport().update()
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self.panning:
            self.panning = False
            self.pan_last = None
            self.unsetCursor()
            event.accept()
            return
        if event.button() == Qt.LeftButton and self.drawing:
            self.drawing = False
            if self.editor.tool == "arrow" and self.preview:
                a = self.preview.arrow
                self.scene().removeItem(self.preview)
                self.preview = None
                if abs(a.x2-a.x1) + abs(a.y2-a.y1) > 4:
                    self.editor.arrows.append(a)
                    self.editor.refresh_scene(keep_transform=True)
                else:
                    self.editor.discard_last_undo()
            elif self.editor.tool == "blur":
                if self.blur_points:
                    self.editor.apply_blur(self.blur_points)
                else:
                    self.editor.discard_last_undo()
                self.blur_points = []
            event.accept()
            return
        super().mouseReleaseEvent(event)

    def paintEvent(self, event):
        super().paintEvent(event)
        if self.drawing and self.editor.tool == "blur" and self.blur_points:
            p = self.mapFromScene(QPointF(*self.blur_points[-1]))
            painter = QPainter(self.viewport())
            size = self.editor.blur_size * self.transform().m11()
            painter.setPen(QPen(QColor(255,255,255,190), 2))
            painter.setBrush(QColor(255,255,255,25))
            painter.drawEllipse(QPointF(p), size/2, size/2)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.settings = QSettings(ORG_NAME, APP_NAME)
        self.paths: list[str] = []
        self.index = -1
        self.image: Image.Image | None = None
        self.exif: bytes | None = None
        self.arrows: list[Arrow] = []
        self.undo_stack: list[EditorState] = []
        self.redo_stack: list[EditorState] = []
        self.tool = "arrow"
        self.space_down = False
        self.arrow_width = int(self.settings.value("arrow_width", 8))
        self.arrow_color = str(self.settings.value("arrow_color", "#ff2b2b"))
        self.blur_size = int(self.settings.value("blur_size", 80))
        self.blur_radius = float(self.settings.value("blur_radius", 16.0))

        self.setWindowTitle(f"PhotoMarker {APP_VERSION}")
        self.resize(1280, 820)
        geom = self.settings.value("window_geometry")
        if geom:
            self.restoreGeometry(geom)
        self.view = PhotoView(self)
        self.setCentralWidget(self.view)
        self.status = QLabel("Откройте фотографию")
        self.statusBar().addWidget(self.status, 1)
        self.zoom_label = QLabel("100%")
        self.statusBar().addPermanentWidget(self.zoom_label)
        self.build_toolbar()
        self.build_shortcuts()

    @property
    def has_image(self):
        return self.image is not None

    def build_toolbar(self):
        tb = QToolBar("Инструменты")
        tb.setMovable(False)
        self.addToolBar(tb)

        def btn(text, fn, tip=""):
            b = QPushButton(text)
            b.clicked.connect(fn)
            b.setToolTip(tip)
            tb.addWidget(b)
            return b

        btn("Открыть", self.open_files, "Ctrl+O")
        tb.addSeparator()
        self.arrow_btn = btn("Стрелка", lambda: self.set_tool("arrow"))
        self.blur_btn = btn("Blur", lambda: self.set_tool("blur"))
        tb.addSeparator()
        tb.addWidget(QLabel(" Толщина: "))
        self.width_spin = QSpinBox()
        self.width_spin.setRange(1, 40)
        self.width_spin.setValue(self.arrow_width)
        self.width_spin.valueChanged.connect(self.set_arrow_width)
        tb.addWidget(self.width_spin)
        btn("Цвет", self.choose_color)
        tb.addSeparator()
        tb.addWidget(QLabel(" Blur: "))
        self.blur_spin = QSpinBox()
        self.blur_spin.setRange(10, 400)
        self.blur_spin.setSuffix(" px")
        self.blur_spin.setValue(self.blur_size)
        self.blur_spin.valueChanged.connect(self.set_blur_size)
        tb.addWidget(self.blur_spin)
        tb.addSeparator()
        btn("↶", self.undo, "Ctrl+Z")
        btn("↷", self.redo, "Ctrl+Y")
        tb.addSeparator()
        btn("←", self.previous, "Предыдущее фото")
        btn("→", self.next, "Следующее фото")
        btn("Сохранить", self.save_current, "Ctrl+S — сохранить поверх оригинала и открыть следующее")
        self.set_tool("arrow")

    def build_shortcuts(self):
        for seq, fn in ((QKeySequence.Open, self.open_files), (QKeySequence.Save, self.save_current),
                        (QKeySequence.Undo, self.undo), (QKeySequence.Redo, self.redo)):
            act = QAction(self)
            act.setShortcut(seq)
            act.triggered.connect(fn)
            self.addAction(act)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Space:
            self.space_down = True
            event.accept()
            return
        super().keyPressEvent(event)

    def keyReleaseEvent(self, event):
        if event.key() == Qt.Key_Space:
            self.space_down = False
            event.accept()
            return
        super().keyReleaseEvent(event)

    def set_tool(self, tool):
        self.tool = tool
        self.arrow_btn.setStyleSheet("font-weight:700" if tool == "arrow" else "")
        self.blur_btn.setStyleSheet("font-weight:700" if tool == "blur" else "")

    def set_arrow_width(self, value):
        self.arrow_width = int(value)
        self.settings.setValue("arrow_width", self.arrow_width)

    def set_blur_size(self, value):
        self.blur_size = int(value)
        self.settings.setValue("blur_size", self.blur_size)

    def choose_color(self):
        c = QColorDialog.getColor(QColor(self.arrow_color), self, "Цвет стрелки")
        if c.isValid():
            self.arrow_color = c.name()
            self.settings.setValue("arrow_color", self.arrow_color)

    def open_files(self):
        files, _ = QFileDialog.getOpenFileNames(self, "Открыть фотографии", "", SUPPORTED)
        if files:
            self.paths = files
            self.index = 0
            self.load_current()

    def load_current(self):
        if not (0 <= self.index < len(self.paths)):
            return
        path = self.paths[self.index]
        try:
            with Image.open(path) as im:
                self.exif = im.info.get("exif")
                self.image = im.convert("RGBA")
            self.arrows = []
            self.undo_stack.clear()
            self.redo_stack.clear()
            self.refresh_scene(keep_transform=False)
            self.status.setText(f"{self.index+1}/{len(self.paths)}  {path}")
        except Exception as e:
            QMessageBox.critical(self, "PhotoMarker", f"Не удалось открыть файл:\n{path}\n\n{e}")

    def refresh_scene(self, keep_transform=True):
        if not self.image:
            return
        old_transform = self.view.transform() if keep_transform else None
        old_center = self.view.mapToScene(self.view.viewport().rect().center()) if keep_transform else None
        sc = self.view.scene()
        sc.clear()
        item = QGraphicsPixmapItem(pil_to_pixmap(self.image))
        item.setZValue(0)
        sc.addItem(item)
        sc.setSceneRect(0, 0, self.image.width, self.image.height)
        for a in self.arrows:
            sc.addItem(ArrowItem(a))
        if keep_transform and old_transform is not None:
            self.view.setTransform(old_transform)
            if old_center is not None:
                self.view.centerOn(old_center)
        else:
            self.view.resetTransform()
            self.view.fitInView(sc.sceneRect(), Qt.KeepAspectRatio)
        self.update_zoom_label()

    def point_inside_image(self, p: QPointF):
        return bool(self.image and 0 <= p.x() <= self.image.width and 0 <= p.y() <= self.image.height)

    def clamp_to_image(self, p: QPointF):
        if not self.image:
            return p
        return QPointF(max(0, min(self.image.width, p.x())), max(0, min(self.image.height, p.y())))

    def push_undo(self):
        if self.image:
            self.undo_stack.append(EditorState(self.image.copy(), copy.deepcopy(self.arrows)))
            if len(self.undo_stack) > 30:
                self.undo_stack.pop(0)
            self.redo_stack.clear()

    def discard_last_undo(self):
        if self.undo_stack:
            self.undo_stack.pop()

    def snapshot(self):
        return EditorState(self.image.copy(), copy.deepcopy(self.arrows))

    def restore_state(self, state: EditorState):
        self.image = state.image.copy()
        self.arrows = copy.deepcopy(state.arrows)
        self.refresh_scene(True)

    def undo(self):
        if self.image and self.undo_stack:
            self.redo_stack.append(self.snapshot())
            self.restore_state(self.undo_stack.pop())

    def redo(self):
        if self.image and self.redo_stack:
            self.undo_stack.append(self.snapshot())
            self.restore_state(self.redo_stack.pop())

    def apply_blur(self, points):
        if self.image:
            self.image = apply_blur_stroke(self.image, points, self.blur_size, self.blur_radius)
            self.refresh_scene(True)

    def save_current(self):
        if not self.image or not (0 <= self.index < len(self.paths)):
            return
        path = self.paths[self.index]
        try:
            save_over_original(self.image, self.arrows, path, self.exif)
            with Image.open(path) as im:
                self.exif = im.info.get("exif")
                self.image = im.convert("RGBA")
            self.arrows = []
            self.undo_stack.clear()
            self.redo_stack.clear()
            if self.index + 1 < len(self.paths):
                self.index += 1
                self.load_current()
            else:
                self.refresh_scene(True)
                self.status.setText(f"Сохранено поверх оригинала: {path}")
        except Exception as e:
            QMessageBox.critical(self, "Ошибка сохранения", f"Оригинал не заменён.\n\n{e}")

    def previous(self):
        if self.index > 0:
            self.index -= 1
            self.load_current()

    def next(self):
        if self.index + 1 < len(self.paths):
            self.index += 1
            self.load_current()

    def update_zoom_label(self):
        self.zoom_label.setText(f"{self.view.transform().m11()*100:.0f}%")

    def closeEvent(self, event):
        self.settings.setValue("window_geometry", self.saveGeometry())
        self.settings.setValue("arrow_width", self.arrow_width)
        self.settings.setValue("arrow_color", self.arrow_color)
        self.settings.setValue("blur_size", self.blur_size)
        self.settings.setValue("blur_radius", self.blur_radius)
        super().closeEvent(event)


def main():
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(APP_VERSION)
    app.setOrganizationName(ORG_NAME)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
