"""Utilities for systematic protein mutation scans."""

from pyrosetta.rosetta.core.pose import Pose

from human_protein_design.mutation import (
    minimize_local_pose,
    mutate_pose,
    repack_local_pose,
)
from human_protein_design.scoring import get_score_terms


AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY"


def prepare_pose(
    pose: Pose,
    score_function,
    center_position: int,
    radius: float = 8.0,
) -> Pose:
    """Locally repack and minimize around a position."""

    pose = repack_local_pose(
        pose,
        score_function,
        center_position=center_position,
        radius=radius,
    )

    pose = minimize_local_pose(
        pose,
        score_function,
        center_position=center_position,
        radius=radius,
    )

    return pose


def scan_position(
    pose: Pose,
    position: int,
    score_function,
    radius: float = 8.0,
) -> list[dict]:
    """Scan all amino-acid substitutions at one position.

    ``reference_total_score`` is the score of the locally prepared WT pose used
    for every delta in the scan. All component terms returned by
    :func:`get_score_terms` are weighted Rosetta contributions.
    """

    wt_aa = pose.residue(position).name1()

    # Prepare WT reference using exactly the same local protocol as every mutant.
    wt_pose = prepare_pose(
        pose,
        score_function,
        center_position=position,
        radius=radius,
    )
    wt_scores = get_score_terms(wt_pose, score_function)
    wt_total = wt_scores["total_score"]

    results = []

    for mutant_aa in AMINO_ACIDS:
        if mutant_aa == wt_aa:
            continue

        mutant_pose = mutate_pose(
            pose,
            position=position,
            mutant_aa=mutant_aa,
        )
        mutant_pose = prepare_pose(
            mutant_pose,
            score_function,
            center_position=position,
            radius=radius,
        )
        mutant_scores = get_score_terms(mutant_pose, score_function)

        result = {
            "position": position,
            "wt_aa": wt_aa,
            "mutant_aa": mutant_aa,
            "mutation": f"{wt_aa}{position}{mutant_aa}",
            "reference_total_score": wt_total,
        }

        # Store the mutant total plus selected weighted Rosetta contributions.
        for term, value in mutant_scores.items():
            result[term] = value

        # Delta is always mutant prepared total minus prepared WT reference total.
        result["delta_score"] = mutant_scores["total_score"] - wt_total
        results.append(result)

    results.sort(key=lambda result: result["delta_score"])
    return results
