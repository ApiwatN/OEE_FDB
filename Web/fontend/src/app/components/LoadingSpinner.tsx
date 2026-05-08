import React from 'react';
import styles from './LoadingSpinner.module.css';

interface LoadingSpinnerProps {
  message?: string;
}

export default function LoadingSpinner({ message = "Loading..." }: LoadingSpinnerProps) {
  return (
    <div className={styles.spinnerContainer}>
      <div className={styles.spinnerWrapper}>
        <div className={styles.spinnerGlow}></div>
        <div className={styles.spinnerRing}></div>
      </div>
      {message && <div className={styles.spinnerText}>{message}</div>}
    </div>
  );
}
