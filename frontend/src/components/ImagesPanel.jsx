import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import ConfirmModal from "./ConfirmModal.jsx";

function fmtBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

export default function ImagesPanel({ refreshTick = 0, addToast }) {
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    try {
      const data = await api.listImages();
      setImages(Array.isArray(data) ? data : []);
    } catch {
      setImages([]);
    }
  };

  useEffect(() => {
    load();
  }, [refreshTick]);

  const remove = async (img) => {
    setBusy(true);
    try {
      await api.removeImage(img.id, true);
      addToast(`Image ${img.id} removed`, "ok");
      await load();
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const prune = async () => {
    setBusy(true);
    try {
      const r = await api.pruneImages();
      const freed = r?.SpaceReclaimed || 0;
      addToast(`Pruned ${(r?.ImagesDeleted || []).length} images, freed ${fmtBytes(freed)}`, "ok");
      await load();
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sidebar-section images-section">
      <div className="section-heading">
        <span>Images</span>
        <span className="section-count">{images.length}</span>
      </div>
      {images.length === 0 ? (
        <p className="section-empty">No local images yet. Use <strong>Pull image</strong> to fetch one.</p>
      ) : (
        <>
          <div className="image-list">
            {images.slice(0, 12).map((img) => {
              const label = img.tags[0] || img.id;
              return (
                <div key={img.id} className="image-item" title={img.tags.join(", ") || img.id}>
                  <div className="image-item__identity">
                    <span className="image-symbol"><Icon name="package" size={14} /></span>
                    <div>
                      <strong>{label}</strong>
                      <small>{fmtBytes(img.size)}</small>
                    </div>
                  </div>
                  <button
                    className="row-icon-button is-danger"
                    onClick={() => setConfirm({ kind: "remove", img })}
                    disabled={busy || img.in_use}
                    title={img.in_use ? "In use by a container" : "Remove image"}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              );
            })}
            {images.length > 12 && (
              <p className="section-empty">{images.length - 12} more not shown.</p>
            )}
          </div>
          <button className="btn btn-soft btn-block" onClick={prune} disabled={busy}>
            <Icon name="trash" size={14} /> Prune dangling
          </button>
        </>
      )}
      <ConfirmModal
        open={!!confirm}
        title="Remove image?"
        message={
          confirm?.img ? (
            <p>
              <strong>{confirm.img.tags[0] || confirm.img.id}</strong> and all
              of its tags will be removed from local storage.
              {confirm.img.in_use && (
                <> This image is currently in use by one or more containers; force removal may stop them.</>
              )}
            </p>
          ) : null
        }
        confirmLabel="Remove"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => remove(confirm.img)}
      />
    </section>
  );
}
