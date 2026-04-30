import styles from "./cube-loader.module.css";

type CubeLoaderProps = {
  className?: string;
  "aria-label"?: string;
};

export function CubeLoader({
  className,
  "aria-label": ariaLabel = "Loading",
}: CubeLoaderProps) {
  return (
    <div className={`${styles.wrapper} ${className ?? ""}`} role="status" aria-label={ariaLabel}>
      <div className={styles.cubeLoader}>
        <div className={`${styles.cube} ${styles.cube1}`} />
        <div className={`${styles.cube} ${styles.cube2}`} />
        <div className={`${styles.cube} ${styles.cube3}`} />
        <div className={`${styles.cube} ${styles.cube4}`} />
      </div>
    </div>
  );
}
