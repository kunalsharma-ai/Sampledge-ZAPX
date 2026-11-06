/** Metro turns an imported image into an asset reference that <Image source> accepts. */
declare module '*.png' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}
