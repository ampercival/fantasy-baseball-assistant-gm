import { describe, expect, test } from "vitest";
import { CsvImportError, parseCsvImport } from "../../supabase/functions/_shared/csv-import";

const ROTOBALLER_CSV = `Rank,Player,Pos,$,Trend,AVG,NFBC,IP,W,ERA,WHIP,K/9,BB/9,S,AB,AVG,HR,RBI,R,SB
Tier 1,
1,Shohei Ohtani,DH,69,no change,1.3,1,0.0,0,0.00,0.00,0.00,0.00,0,404,.297,26,70,73,6
2,Juan Soto,OF,50,rising,3.7,4,0.0,0,0.00,0.00,0.00,0.00,0,293,.283,21,52,46,7
3,Jacob Misiorowski,SP,49,rising,121.7,121,127.0,11,1.63,0.73,13.82,2.06,0,0,.000,0,0,0,0
4,Bobby Witt Jr.,SS,47,rising,3.3,3,0.0,0,0.00,0.00,0.00,0.00,0,377,.281,13,41,53,30
5,Yordan Alvarez,OF,45,rising,30.0,33,0.0,0,0.00,0.00,0.00,0.00,0,414,.329,35,85,78,1
Tier 2,
6,James Wood,OF,43,rising,32.3,31,0.0,0,0.00,0.00,0.00,0.00,0,437,.265,30,73,100,17`;

describe("parseCsvImport", () => {
  test("accepts the Rotoballer export and ignores tier separators", () => {
    const entries = parseCsvImport(ROTOBALLER_CSV);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toEqual({ age: null, player_name: "Shohei Ohtani", positions: "DH", rank: 1, team: null });
    expect(entries[2]).toMatchObject({ player_name: "Jacob Misiorowski", positions: "SP", rank: 3 });
    expect(entries[5]).toMatchObject({ player_name: "James Wood", rank: 6 });
  });

  test("supports aliases, quoted delimiters, optional metadata, and duplicate players", () => {
    const entries = parseCsvImport('ranking,name,org,position,age\n2,"Smith, John",NYY,SS,22.5\n1,Ada Ace,LAD,OF,24\n3,Ada Ace,LAD,OF,24');
    expect(entries).toEqual([
      { age: 24, player_name: "Ada Ace", positions: "OF", rank: 1, team: "LAD" },
      { age: 22.5, player_name: "Smith, John", positions: "SS", rank: 2, team: "NYY" },
    ]);
  });

  test("reports missing required headers and invalid rows", () => {
    expect(() => parseCsvImport("Player,Pos\nShohei Ohtani,DH")).toThrow(CsvImportError);
    expect(() => parseCsvImport("Rank,Player\nTier 1,")).toThrow("CSV import did not contain any valid ranking rows.");
  });
});
