import { useEffect, useState } from "react";

export function FullName({ first, last, items }) {
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName([first, last].join(" "));
  }, [first, last]);
  return (
    <ul>
      <li>{fullName}</li>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
