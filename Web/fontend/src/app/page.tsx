"use client";

import { useState, useEffect } from 'react'
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/oee_production/machine_area");
  }, [router]);

  return (
    <>
    </>
  );
}
