// The raw numeric values for a CSS transform (scale, translate, rotate)
export interface TransformValues {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
  rotate: number;
}

// A Motion extends the raw transform with animation timing info
export interface Motion extends TransformValues {
  duration: number;
  timing?: string;
}

// Partial updates to push into React state (all fields optional)
export interface TransformUpdates {
  transform?: string;
  duration?: number;
  timing?: string;
}
